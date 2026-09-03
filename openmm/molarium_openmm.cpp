#include "OpenMM.h"
#include "openmm/LocalEnergyMinimizer.h"
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <algorithm>
#include <cmath>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace OpenMM;

namespace {

struct ElementParameters {
    double mass;
    double covalentRadiusAngstrom;
    double uffDistanceAngstrom;
    double epsilonKilojoule;
};

std::unique_ptr<System> currentSystem;
std::unique_ptr<LangevinMiddleIntegrator> currentIntegrator;
std::unique_ptr<Context> currentContext;
std::string lastError;
bool velocitiesInitialized = false;
std::string currentForcefieldName = "OpenFF Sage 2.1.0 (Gasteiger charges)";

ElementParameters parametersForAtomicNumber(int atomicNumber) {
    // UFF-like van der Waals distances and well depths.  Bond and angle terms
    // are assigned below by MolariumFF; this is intentionally a compact browser
    // parameterizer, not a substitute for a curated biomolecular force field.
    switch (atomicNumber) {
        case 1:  return {1.00794, 0.31, 2.886, 0.044 * 4.184};
        case 5:  return {10.811, 0.85, 4.083, 0.180 * 4.184};
        case 6:  return {12.0107, 0.76, 3.851, 0.105 * 4.184};
        case 7:  return {14.0067, 0.71, 3.660, 0.069 * 4.184};
        case 8:  return {15.9994, 0.66, 3.500, 0.060 * 4.184};
        case 9:  return {18.9984, 0.57, 3.364, 0.050 * 4.184};
        case 14: return {28.0855, 1.11, 4.295, 0.402 * 4.184};
        case 15: return {30.9738, 1.07, 4.147, 0.305 * 4.184};
        case 16: return {32.065, 1.05, 4.035, 0.274 * 4.184};
        case 17: return {35.453, 1.02, 3.947, 0.227 * 4.184};
        case 35: return {79.904, 1.20, 4.189, 0.251 * 4.184};
        case 53: return {126.9045, 1.39, 4.500, 0.339 * 4.184};
        default: throw std::invalid_argument("The legacy UFF-like browser model does not support one of the molecule's elements");
    }
}

double bondOrderScale(double order) {
    if (order >= 2.8)
        return 0.78;
    if (order >= 1.8)
        return 0.88;
    if (order >= 1.35)
        return 0.92;
    return 1.0;
}

double targetAngleRadians(int centerAtomicNumber,
                          const std::vector<std::pair<int, double>>& neighbors) {
    bool hasTripleBond = false;
    bool hasMultipleBond = false;
    bool hasAromaticBond = false;
    for (const auto& neighbor : neighbors) {
        hasTripleBond |= neighbor.second >= 2.8;
        hasMultipleBond |= neighbor.second >= 1.8;
        hasAromaticBond |= neighbor.second >= 1.35 && neighbor.second < 1.8;
    }
    double degrees = 109.47;
    if (hasTripleBond && neighbors.size() == 2)
        degrees = 180.0;
    else if (hasMultipleBond || hasAromaticBond)
        degrees = 120.0;
    else if (centerAtomicNumber == 8 && neighbors.size() == 2)
        degrees = 104.5;
    else if (centerAtomicNumber == 7 && neighbors.size() == 3)
        degrees = 107.0;
    else if (centerAtomicNumber == 16 && neighbors.size() == 2)
        degrees = 104.0;
    return degrees * M_PI / 180.0;
}

void resetModel() {
    currentContext.reset();
    currentIntegrator.reset();
    currentSystem.reset();
    velocitiesInitialized = false;
}

void requireAtomIndex(int atom, int atomCount, const char* term) {
    if (atom < 0 || atom >= atomCount)
        throw std::invalid_argument(std::string(term) + " contains an invalid atom index");
}

void requireContext() {
    if (!currentContext)
        throw std::runtime_error("No molecule has been initialized");
}

double potentialEnergy() {
    requireContext();
    return currentContext->getState(State::Energy).getPotentialEnergy();
}

template <class Callback>
int reportErrors(Callback callback) {
    lastError.clear();
    try {
        callback();
        return 1;
    }
    catch (const std::exception& error) {
        lastError = error.what();
    }
    catch (...) {
        lastError = "Unknown OpenMM error";
    }
    return 0;
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE
const char* molarium_openmm_version() {
    static const std::string version = Platform::getOpenMMVersion();
    return version.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* molarium_forcefield_name() {
    return currentForcefieldName.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* molarium_last_error() {
    return lastError.c_str();
}

EMSCRIPTEN_KEEPALIVE
void molarium_destroy() {
    resetModel();
    lastError.clear();
}

EMSCRIPTEN_KEEPALIVE
int molarium_initialize(int atomCount,
                     const int* atomicNumbers,
                     const double* positionsAngstrom,
                     const double* formalCharges,
                     int bondCount,
                     const int* bondAtomsA,
                     const int* bondAtomsB,
                     const double* bondOrders) {
    resetModel();
    return reportErrors([&]() {
        currentForcefieldName = "Legacy UFF-like browser model 0.1";
        if (atomCount <= 0)
            throw std::invalid_argument("The molecule has no atoms");
        if (!atomicNumbers || !positionsAngstrom || !formalCharges)
            throw std::invalid_argument("Missing atom arrays");
        if (bondCount < 0 || (bondCount > 0 && (!bondAtomsA || !bondAtomsB || !bondOrders)))
            throw std::invalid_argument("Missing bond arrays");

        auto system = std::make_unique<System>();
        auto bondForce = std::make_unique<HarmonicBondForce>();
        auto angleForce = std::make_unique<HarmonicAngleForce>();
        auto torsionForce = std::make_unique<PeriodicTorsionForce>();
        auto nonbondedForce = std::make_unique<NonbondedForce>();
        nonbondedForce->setNonbondedMethod(NonbondedForce::NoCutoff);
        nonbondedForce->setUseDispersionCorrection(false);

        std::vector<ElementParameters> elementParameters;
        elementParameters.reserve(atomCount);
        for (int atom = 0; atom < atomCount; atom++) {
            const auto parameters = parametersForAtomicNumber(atomicNumbers[atom]);
            elementParameters.push_back(parameters);
            system->addParticle(parameters.mass);

            const double sigmaNanometer =
                parameters.uffDistanceAngstrom * 0.1 / std::pow(2.0, 1.0 / 6.0);
            nonbondedForce->addParticle(formalCharges[atom], sigmaNanometer,
                                        parameters.epsilonKilojoule);
        }

        std::vector<std::vector<std::pair<int, double>>> adjacency(atomCount);
        std::vector<std::pair<int, int>> bondPairs;
        std::set<std::pair<int, int>> uniqueBonds;
        for (int bond = 0; bond < bondCount; bond++) {
            int atomA = bondAtomsA[bond];
            int atomB = bondAtomsB[bond];
            if (atomA < 0 || atomA >= atomCount || atomB < 0 || atomB >= atomCount || atomA == atomB)
                throw std::invalid_argument("A bond contains an invalid atom index");
            if (atomA > atomB)
                std::swap(atomA, atomB);
            if (!uniqueBonds.insert({atomA, atomB}).second)
                continue;

            const double order = std::clamp(bondOrders[bond], 1.0, 3.0);
            adjacency[atomA].push_back({atomB, order});
            adjacency[atomB].push_back({atomA, order});
            bondPairs.push_back({atomA, atomB});

            const double equilibriumAngstrom =
                (elementParameters[atomA].covalentRadiusAngstrom +
                 elementParameters[atomB].covalentRadiusAngstrom) * bondOrderScale(order);
            const double forceConstant = 260000.0 * std::max(1.0, order * 0.85);
            bondForce->addBond(atomA, atomB, equilibriumAngstrom * 0.1, forceConstant);
        }

        for (int center = 0; center < atomCount; center++) {
            const auto& neighbors = adjacency[center];
            if (neighbors.size() < 2)
                continue;
            const double target = targetAngleRadians(atomicNumbers[center], neighbors);
            for (size_t first = 0; first < neighbors.size(); first++) {
                for (size_t second = first + 1; second < neighbors.size(); second++)
                    angleForce->addAngle(neighbors[first].first, center, neighbors[second].first,
                                         target, 320.0);
            }
        }

        std::set<std::vector<int>> uniqueTorsions;
        for (const auto& centralBond : bondPairs) {
            const int centerA = centralBond.first;
            const int centerB = centralBond.second;
            double centralOrder = 1.0;
            for (const auto& entry : adjacency[centerA])
                if (entry.first == centerB)
                    centralOrder = entry.second;
            for (const auto& outerA : adjacency[centerA]) {
                if (outerA.first == centerB)
                    continue;
                for (const auto& outerB : adjacency[centerB]) {
                    if (outerB.first == centerA || outerB.first == outerA.first)
                        continue;
                    std::vector<int> key = {outerA.first, centerA, centerB, outerB.first};
                    std::vector<int> reverse = {outerB.first, centerB, centerA, outerA.first};
                    if (reverse < key)
                        key = reverse;
                    if (!uniqueTorsions.insert(key).second)
                        continue;
                    if (centralOrder >= 1.35)
                        torsionForce->addTorsion(outerA.first, centerA, centerB, outerB.first,
                                                 2, M_PI, 12.0);
                    else
                        torsionForce->addTorsion(outerA.first, centerA, centerB, outerB.first,
                                                 3, 0.0, 1.2);
                }
            }
        }

        nonbondedForce->createExceptionsFromBonds(bondPairs, 1.0 / 1.2, 0.5);
        system->addForce(bondForce.release());
        system->addForce(angleForce.release());
        system->addForce(torsionForce.release());
        system->addForce(nonbondedForce.release());
        system->addForce(new CMMotionRemover(1));

        std::vector<Vec3> positions(atomCount);
        for (int atom = 0; atom < atomCount; atom++) {
            positions[atom] = Vec3(positionsAngstrom[atom * 3] * 0.1,
                                   positionsAngstrom[atom * 3 + 1] * 0.1,
                                   positionsAngstrom[atom * 3 + 2] * 0.1);
        }

        auto integrator = std::make_unique<LangevinMiddleIntegrator>(300.0, 1.0, 0.001);
        integrator->setRandomNumberSeed(20260816);
        auto context = std::make_unique<Context>(*system, *integrator,
                                                 Platform::getPlatformByName("Reference"));
        context->setPositions(positions);

        currentSystem = std::move(system);
        currentIntegrator = std::move(integrator);
        currentContext = std::move(context);
        velocitiesInitialized = false;
        (void) potentialEnergy();
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_initialize_sage(
        int atomCount, const double* massesAmu, const double* positionsAngstrom,
        int constraintCount, const int* constraintAtomsA, const int* constraintAtomsB,
        const double* constraintDistancesNanometer,
        int bondCount, const int* bondAtomsA, const int* bondAtomsB,
        const double* bondLengthsNanometer, const double* bondForceConstants,
        int angleCount, const int* angleAtomsA, const int* angleAtomsB, const int* angleAtomsC,
        const double* angleRadians, const double* angleForceConstants,
        int torsionCount, const int* torsionAtomsA, const int* torsionAtomsB,
        const int* torsionAtomsC, const int* torsionAtomsD, const int* torsionPeriodicities,
        const double* torsionPhasesRadians, const double* torsionForceConstants,
        const double* chargesElementary, const double* sigmasNanometer,
        const double* epsilonsKilojoule,
        int exceptionCount, const int* exceptionAtomsA, const int* exceptionAtomsB,
        const double* exceptionChargeProducts, const double* exceptionSigmasNanometer,
        const double* exceptionEpsilonsKilojoule,
        int useObc2ImplicitSolvent, const double* obcRadiiNanometer,
        const double* obcScaleFactors, double timestepPicoseconds,
        double cutoffNanometer) {
    resetModel();
    return reportErrors([&]() {
        currentForcefieldName = "OpenFF Sage 2.1.0 (Gasteiger charges)";
        if (atomCount <= 0)
            throw std::invalid_argument("The molecule has no atoms");
        if (!massesAmu || !positionsAngstrom || !chargesElementary ||
            !sigmasNanometer || !epsilonsKilojoule)
            throw std::invalid_argument("Missing Sage particle arrays");
        if (constraintCount < 0 || (constraintCount &&
            (!constraintAtomsA || !constraintAtomsB || !constraintDistancesNanometer)))
            throw std::invalid_argument("Missing Sage constraint arrays");
        if (bondCount < 0 || (bondCount && (!bondAtomsA || !bondAtomsB ||
            !bondLengthsNanometer || !bondForceConstants)))
            throw std::invalid_argument("Missing Sage bond arrays");
        if (angleCount < 0 || (angleCount && (!angleAtomsA || !angleAtomsB || !angleAtomsC ||
            !angleRadians || !angleForceConstants)))
            throw std::invalid_argument("Missing Sage angle arrays");
        if (torsionCount < 0 || (torsionCount && (!torsionAtomsA || !torsionAtomsB ||
            !torsionAtomsC || !torsionAtomsD || !torsionPeriodicities ||
            !torsionPhasesRadians || !torsionForceConstants)))
            throw std::invalid_argument("Missing Sage torsion arrays");
        if (exceptionCount < 0 || (exceptionCount && (!exceptionAtomsA || !exceptionAtomsB ||
            !exceptionChargeProducts || !exceptionSigmasNanometer ||
            !exceptionEpsilonsKilojoule)))
            throw std::invalid_argument("Missing Sage exception arrays");
        if (useObc2ImplicitSolvent && (!obcRadiiNanometer || !obcScaleFactors))
            throw std::invalid_argument("Missing OBC2 implicit-solvent arrays");

        auto system = std::make_unique<System>();
        auto bondForce = std::make_unique<HarmonicBondForce>();
        auto angleForce = std::make_unique<HarmonicAngleForce>();
        auto torsionForce = std::make_unique<PeriodicTorsionForce>();
        auto nonbondedForce = std::make_unique<NonbondedForce>();
        std::unique_ptr<GBSAOBCForce> implicitSolventForce;
        if (!(timestepPicoseconds > 0.0) || timestepPicoseconds > 0.004)
            throw std::invalid_argument("The dynamics timestep must be in (0, 0.004] ps");
        if (cutoffNanometer < 0.0 || cutoffNanometer > 5.0 ||
            (cutoffNanometer > 0.0 && cutoffNanometer < 0.3))
            throw std::invalid_argument("The nonbonded cutoff must be zero or in [0.3, 5] nm");
        nonbondedForce->setNonbondedMethod(cutoffNanometer > 0.0
            ? NonbondedForce::CutoffNonPeriodic : NonbondedForce::NoCutoff);
        if (cutoffNanometer > 0.0) {
            nonbondedForce->setCutoffDistance(cutoffNanometer);
            // Dielectric 1 produces a force-shifted Coulomb interaction in
            // OpenMM's cutoff implementation without adding a solvent model.
            nonbondedForce->setReactionFieldDielectric(1.0);
        }
        nonbondedForce->setUseDispersionCorrection(false);
        if (useObc2ImplicitSolvent) {
            implicitSolventForce = std::make_unique<GBSAOBCForce>();
            implicitSolventForce->setNonbondedMethod(cutoffNanometer > 0.0
                ? GBSAOBCForce::CutoffNonPeriodic : GBSAOBCForce::NoCutoff);
            if (cutoffNanometer > 0.0)
                implicitSolventForce->setCutoffDistance(cutoffNanometer);
            implicitSolventForce->setSolventDielectric(78.3);
            implicitSolventForce->setSoluteDielectric(1.0);
            implicitSolventForce->setSurfaceAreaEnergy(2.25936);
        }

        for (int atom = 0; atom < atomCount; atom++) {
            if (!(massesAmu[atom] > 0.0) || !(sigmasNanometer[atom] > 0.0) ||
                epsilonsKilojoule[atom] < 0.0)
                throw std::invalid_argument("A Sage particle parameter is invalid");
            system->addParticle(massesAmu[atom]);
            nonbondedForce->addParticle(chargesElementary[atom], sigmasNanometer[atom],
                                        epsilonsKilojoule[atom]);
            if (implicitSolventForce) {
                if (!(obcRadiiNanometer[atom] > 0.009) || !(obcScaleFactors[atom] > 0.0))
                    throw std::invalid_argument("An OBC2 particle parameter is invalid");
                implicitSolventForce->addParticle(chargesElementary[atom],
                                                  obcRadiiNanometer[atom],
                                                  obcScaleFactors[atom]);
            }
        }
        for (int term = 0; term < constraintCount; term++) {
            requireAtomIndex(constraintAtomsA[term], atomCount, "A constraint");
            requireAtomIndex(constraintAtomsB[term], atomCount, "A constraint");
            if (!(constraintDistancesNanometer[term] > 0.0))
                throw std::invalid_argument("A Sage constraint distance is invalid");
            system->addConstraint(constraintAtomsA[term], constraintAtomsB[term],
                                  constraintDistancesNanometer[term]);
        }
        for (int term = 0; term < bondCount; term++) {
            requireAtomIndex(bondAtomsA[term], atomCount, "A bond");
            requireAtomIndex(bondAtomsB[term], atomCount, "A bond");
            bondForce->addBond(bondAtomsA[term], bondAtomsB[term],
                               bondLengthsNanometer[term], bondForceConstants[term]);
        }
        for (int term = 0; term < angleCount; term++) {
            requireAtomIndex(angleAtomsA[term], atomCount, "An angle");
            requireAtomIndex(angleAtomsB[term], atomCount, "An angle");
            requireAtomIndex(angleAtomsC[term], atomCount, "An angle");
            angleForce->addAngle(angleAtomsA[term], angleAtomsB[term], angleAtomsC[term],
                                 angleRadians[term], angleForceConstants[term]);
        }
        for (int term = 0; term < torsionCount; term++) {
            requireAtomIndex(torsionAtomsA[term], atomCount, "A torsion");
            requireAtomIndex(torsionAtomsB[term], atomCount, "A torsion");
            requireAtomIndex(torsionAtomsC[term], atomCount, "A torsion");
            requireAtomIndex(torsionAtomsD[term], atomCount, "A torsion");
            if (torsionPeriodicities[term] <= 0)
                throw std::invalid_argument("A Sage torsion periodicity is invalid");
            torsionForce->addTorsion(torsionAtomsA[term], torsionAtomsB[term],
                                     torsionAtomsC[term], torsionAtomsD[term],
                                     torsionPeriodicities[term], torsionPhasesRadians[term],
                                     torsionForceConstants[term]);
        }
        for (int term = 0; term < exceptionCount; term++) {
            requireAtomIndex(exceptionAtomsA[term], atomCount, "An exception");
            requireAtomIndex(exceptionAtomsB[term], atomCount, "An exception");
            nonbondedForce->addException(exceptionAtomsA[term], exceptionAtomsB[term],
                                         exceptionChargeProducts[term],
                                         exceptionSigmasNanometer[term],
                                         exceptionEpsilonsKilojoule[term]);
        }

        system->addForce(bondForce.release());
        system->addForce(angleForce.release());
        system->addForce(torsionForce.release());
        system->addForce(nonbondedForce.release());
        if (implicitSolventForce)
            system->addForce(implicitSolventForce.release());
        system->addForce(new CMMotionRemover(1));

        std::vector<Vec3> positions(atomCount);
        for (int atom = 0; atom < atomCount; atom++) {
            positions[atom] = Vec3(positionsAngstrom[atom * 3] * 0.1,
                                   positionsAngstrom[atom * 3 + 1] * 0.1,
                                   positionsAngstrom[atom * 3 + 2] * 0.1);
        }
        auto integrator = std::make_unique<LangevinMiddleIntegrator>(300.0, 1.0,
                                                                     timestepPicoseconds);
        integrator->setConstraintTolerance(1e-5);
        integrator->setRandomNumberSeed(20260817);
        auto context = std::make_unique<Context>(*system, *integrator,
                                                 Platform::getPlatformByName("Reference"));
        context->setPositions(positions);

        currentSystem = std::move(system);
        currentIntegrator = std::move(integrator);
        currentContext = std::move(context);
        velocitiesInitialized = false;
        (void) potentialEnergy();
    });
}

EMSCRIPTEN_KEEPALIVE
double molarium_get_potential_energy() {
    double energy = 0.0;
    if (!reportErrors([&]() { energy = potentialEnergy(); }))
        return NAN;
    return energy;
}

EMSCRIPTEN_KEEPALIVE
int molarium_minimize(double toleranceKilojoulePerNanometer, int maxIterations) {
    return reportErrors([&]() {
        requireContext();
        LocalEnergyMinimizer::minimize(*currentContext,
                                       std::max(0.001, toleranceKilojoulePerNanometer),
                                       std::max(0, maxIterations));
        velocitiesInitialized = false;
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_set_positions(const double* positionsAngstrom, int capacity) {
    return reportErrors([&]() {
        requireContext();
        const int atomCount = currentSystem->getNumParticles();
        if (!positionsAngstrom || capacity < atomCount * 3)
            throw std::invalid_argument("The input position buffer is too small");
        std::vector<Vec3> positions(atomCount);
        for (int atom = 0; atom < atomCount; atom++) {
            positions[atom] = Vec3(positionsAngstrom[atom * 3] * 0.1,
                                   positionsAngstrom[atom * 3 + 1] * 0.1,
                                   positionsAngstrom[atom * 3 + 2] * 0.1);
        }
        currentContext->setPositions(positions);
        velocitiesInitialized = false;
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_relax_fixed(int iterations, double stepScale, double maximumDisplacementAngstrom) {
    return reportErrors([&]() {
        requireContext();
        if (iterations < 0)
            throw std::invalid_argument("The fixed-relaxation iteration count cannot be negative");
        if (!(stepScale > 0.0) || !(maximumDisplacementAngstrom > 0.0))
            throw std::invalid_argument("The fixed-relaxation scale and displacement cap must be positive");
        constexpr double kilojouleNanometerToKcalAngstrom = (1.0 / 4.184) * 0.1;
        for (int iteration = 0; iteration < iterations; iteration++) {
            const State state = currentContext->getState(State::Positions | State::Forces);
            std::vector<Vec3> positions = state.getPositions();
            const std::vector<Vec3>& forces = state.getForces();
            for (size_t atom = 0; atom < positions.size(); atom++) {
                const Vec3 force = forces[atom] * kilojouleNanometerToKcalAngstrom;
                const double magnitude = std::sqrt(force.dot(force));
                const double scale = magnitude > 1e-12
                    ? std::min(stepScale, maximumDisplacementAngstrom / magnitude)
                    : stepScale;
                positions[atom] += force * (scale * 0.1);
            }
            currentContext->setPositions(positions);
            if (currentSystem->getNumConstraints() > 0)
                currentContext->applyConstraints(1e-5);
        }
        velocitiesInitialized = false;
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_set_dynamics(double temperatureKelvin, double collisionRatePerPicosecond) {
    return reportErrors([&]() {
        requireContext();
        if (!(temperatureKelvin > 0.0) || collisionRatePerPicosecond < 0.0)
            throw std::invalid_argument("Temperature must be positive and collision rate non-negative");
        currentIntegrator->setTemperature(temperatureKelvin);
        currentIntegrator->setFriction(collisionRatePerPicosecond);
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_step(int steps, double temperatureKelvin) {
    return reportErrors([&]() {
        requireContext();
        if (steps < 0)
            throw std::invalid_argument("The dynamics step count cannot be negative");
        if (!velocitiesInitialized) {
            currentContext->setVelocitiesToTemperature(std::max(1.0, temperatureKelvin), 20260816);
            velocitiesInitialized = true;
        }
        currentIntegrator->setTemperature(std::max(1.0, temperatureKelvin));
        currentIntegrator->step(steps);
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_get_positions(double* positionsAngstrom, int capacity) {
    return reportErrors([&]() {
        requireContext();
        const auto positions = currentContext->getState(State::Positions).getPositions();
        if (!positionsAngstrom || capacity < static_cast<int>(positions.size()) * 3)
            throw std::invalid_argument("The output position buffer is too small");
        for (size_t atom = 0; atom < positions.size(); atom++) {
            positionsAngstrom[atom * 3] = positions[atom][0] * 10.0;
            positionsAngstrom[atom * 3 + 1] = positions[atom][1] * 10.0;
            positionsAngstrom[atom * 3 + 2] = positions[atom][2] * 10.0;
        }
    });
}

EMSCRIPTEN_KEEPALIVE
int molarium_get_forces(double* forcesKilojoulePerMoleNanometer, int capacity) {
    return reportErrors([&]() {
        requireContext();
        const auto forces = currentContext->getState(State::Forces).getForces();
        if (!forcesKilojoulePerMoleNanometer || capacity < static_cast<int>(forces.size()) * 3)
            throw std::invalid_argument("The output force buffer is too small");
        for (size_t atom = 0; atom < forces.size(); atom++) {
            forcesKilojoulePerMoleNanometer[atom * 3] = forces[atom][0];
            forcesKilojoulePerMoleNanometer[atom * 3 + 1] = forces[atom][1];
            forcesKilojoulePerMoleNanometer[atom * 3 + 2] = forces[atom][2];
        }
    });
}

} // extern "C"
