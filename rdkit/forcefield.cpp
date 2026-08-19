// Molarium force-field bridge for the BSD-licensed RDKit MinimalLib.
// The molecular potentials and analytical gradients come directly from
// RDKit's established MMFF94 and UFF implementations.

#include "minilib.h"

#include <ForceField/ForceField.h>
#include <GraphMol/ForceFieldHelpers/MMFF/AtomTyper.h>
#include <GraphMol/ForceFieldHelpers/MMFF/Builder.h>
#include <GraphMol/ForceFieldHelpers/UFF/AtomTyper.h>
#include <GraphMol/ForceFieldHelpers/UFF/Builder.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/PartialCharges/GasteigerCharges.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/SmilesParse/SmilesWrite.h>
#include <GraphMol/Substruct/SubstructMatch.h>
#include <GraphMol/Trajectory/Trajectory.h>
#include <Geometry/point.h>
#include <RDGeneral/versions.h>

#include <rapidjson/document.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

namespace rj = rapidjson;

namespace {

constexpr double kBoltzmannKcal = 0.00198720425864083;
// Converts (kcal/mol/angstrom)/dalton to angstrom/fs^2.
constexpr double kForceToAcceleration = 1.0 / 2390.05736153349;

struct ParameterizedField {
  std::unique_ptr<ForceFields::ForceField> field;
  std::string name;
  bool fallback = false;
};

ParameterizedField parameterize(RDKit::RWMol &mol, int conformerId = -1) {
  auto properties =
      std::make_unique<RDKit::MMFF::MMFFMolProperties>(mol, "MMFF94");
  if (properties->isValid()) {
    std::unique_ptr<ForceFields::ForceField> field(
        RDKit::MMFF::constructForceField(mol, properties.get(), 100.0,
                                         conformerId,
                                         false));
    if (field) {
      field->initialize();
      return {std::move(field), "MMFF94", false};
    }
  }

  auto atomTypes = RDKit::UFF::getAtomTypes(mol);
  if (!atomTypes.second) {
    throw std::runtime_error(
        "Neither MMFF94 nor UFF has parameters for this molecule");
  }
  std::unique_ptr<ForceFields::ForceField> field(
      RDKit::UFF::constructForceField(mol, atomTypes.first, 100.0,
                                      conformerId,
                                      false));
  if (!field) {
    throw std::runtime_error("UFF could not construct a force field");
  }
  field->initialize();
  return {std::move(field), "UFF", true};
}

std::vector<double> conformerPositions(const RDKit::ROMol &mol,
                                       int conformerId = -1) {
  if (!mol.getNumConformers()) {
    throw std::runtime_error("The molecule has no 3D conformer");
  }
  const auto &conformer = mol.getConformer(conformerId);
  std::vector<double> positions(mol.getNumAtoms() * 3);
  for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
    const auto &point = conformer.getAtomPos(atom);
    positions[atom * 3] = point.x;
    positions[atom * 3 + 1] = point.y;
    positions[atom * 3 + 2] = point.z;
  }
  return positions;
}

void addPositions(rj::Value &conformers,
                  rj::Document::AllocatorType &allocator,
                  const std::vector<double> &positions) {
  rj::Value coordinates(rj::kArrayType);
  coordinates.Reserve(static_cast<rj::SizeType>(positions.size()), allocator);
  for (double value : positions) coordinates.PushBack(value, allocator);
  conformers.PushBack(coordinates, allocator);
}

void setConformerPositions(RDKit::ROMol &mol,
                           const std::vector<double> &positions) {
  auto &conformer = mol.getConformer();
  for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
    conformer.setAtomPos(
        atom, RDGeom::Point3D(positions[atom * 3], positions[atom * 3 + 1],
                              positions[atom * 3 + 2]));
  }
}

void addFrame(rj::Value &frames, rj::Document::AllocatorType &allocator,
              unsigned int step, double energy,
              const std::vector<double> &positions) {
  rj::Value frame(rj::kObjectType);
  frame.AddMember("step", step, allocator);
  frame.AddMember("energy", energy, allocator);
  rj::Value coordinates(rj::kArrayType);
  coordinates.Reserve(static_cast<rj::SizeType>(positions.size()), allocator);
  for (double value : positions) {
    coordinates.PushBack(value, allocator);
  }
  frame.AddMember("positions", coordinates, allocator);
  frames.PushBack(frame, allocator);
}

std::vector<double> snapshotPositions(const RDKit::Snapshot &snapshot,
                                      unsigned int atomCount) {
  std::vector<double> positions(atomCount * 3);
  for (unsigned int atom = 0; atom < atomCount; ++atom) {
    const auto point = snapshot.getPoint3D(atom);
    positions[atom * 3] = point.x;
    positions[atom * 3 + 1] = point.y;
    positions[atom * 3 + 2] = point.z;
  }
  return positions;
}

bool finitePositions(const std::vector<double> &positions) {
  return std::all_of(positions.begin(), positions.end(),
                     [](double value) { return std::isfinite(value); });
}

std::vector<unsigned int> parseFixedAtomIndices(const std::string &data,
                                                unsigned int atomCount) {
  if (data.empty()) return {};
  rj::Document document;
  document.Parse(data.c_str());
  if (document.HasParseError() || !document.IsArray()) {
    throw std::invalid_argument("Fixed atom indices must be a JSON array");
  }
  std::set<unsigned int> unique;
  for (const auto &value : document.GetArray()) {
    if (!value.IsUint() || value.GetUint() >= atomCount) {
      throw std::invalid_argument("A fixed atom index is out of range");
    }
    unique.insert(value.GetUint());
  }
  return {unique.begin(), unique.end()};
}

struct EmpiricalPka {
  unsigned int queryAtom = 0;
  double mean = 0.0;
  double deviation = 0.0;
};

struct IonizableDefinition {
  std::string name;
  std::string smarts;
  std::vector<EmpiricalPka> pkas;
};

enum class AllowedProtonation { Deprotonated, Protonated, Both };

struct IonizableAction {
  std::string name;
  unsigned int atom = 0;
  std::string element;
  double mean = 0.0;
  double deviation = 0.0;
  AllowedProtonation allowed = AllowedProtonation::Both;
};

struct ProtonationChoice {
  unsigned int site = 0;
  bool protonated = false;
};

struct ProtonationVariant {
  std::shared_ptr<RDKit::RWMol> molecule;
  std::vector<ProtonationChoice> choices;
  double logWeight = 0.0;
  std::string smiles;
  double population = 0.0;
  int formalCharge = 0;
};

std::vector<IonizableDefinition> parseIonizableDefinitions(
    const std::string &siteData) {
  std::vector<IonizableDefinition> definitions;
  std::istringstream input(siteData);
  std::string line;
  unsigned int lineNumber = 0;
  while (std::getline(input, line)) {
    lineNumber++;
    if (line.empty() || line.front() == '#') continue;
    std::istringstream fields(line);
    IonizableDefinition definition;
    if (!(fields >> definition.name >> definition.smarts)) {
      throw std::invalid_argument("Malformed ionizable-site row " +
                                  std::to_string(lineNumber));
    }
    int queryAtom = -1;
    double mean = 0.0;
    double deviation = 0.0;
    while (fields >> queryAtom >> mean >> deviation) {
      if (queryAtom < 0 || !std::isfinite(mean) ||
          !std::isfinite(deviation) || deviation < 0.0) {
        throw std::invalid_argument("Invalid pKa datum on row " +
                                    std::to_string(lineNumber));
      }
      definition.pkas.push_back(
          {static_cast<unsigned int>(queryAtom), mean, deviation});
    }
    if (definition.pkas.empty() || !fields.eof()) {
      throw std::invalid_argument("Incomplete ionizable-site row " +
                                  std::to_string(lineNumber));
    }
    definitions.push_back(std::move(definition));
  }
  if (definitions.empty()) {
    throw std::invalid_argument("No ionizable-site definitions were supplied");
  }
  return definitions;
}

AllowedProtonation allowedProtonation(double mean, double deviation,
                                      double phMin, double phMax,
                                      double precision) {
  const double pkaMin = mean - precision * deviation;
  const double pkaMax = mean + precision * deviation;
  if (pkaMin <= phMax && phMin <= pkaMax) return AllowedProtonation::Both;
  return mean > phMax ? AllowedProtonation::Protonated
                      : AllowedProtonation::Deprotonated;
}

const char *allowedName(AllowedProtonation allowed) {
  if (allowed == AllowedProtonation::Protonated) return "PROTONATED";
  if (allowed == AllowedProtonation::Deprotonated) return "DEPROTONATED";
  return "BOTH";
}

double protonatedFraction(double ph, double pka) {
  const double exponent = std::max(-300.0, std::min(300.0, ph - pka));
  return 1.0 / (1.0 + std::pow(10.0, exponent));
}

void applyProtonationChoice(RDKit::RWMol &molecule,
                            const IonizableAction &action,
                            bool protonated) {
  if (action.atom >= molecule.getNumAtoms()) {
    throw std::runtime_error("Ionizable-site atom index is out of range");
  }
  auto *atom = molecule.getAtomWithIdx(action.atom);
  const bool specialNitrogen = !action.name.empty() && action.name.front() == '*';
  const int genericCharge = protonated ? 0 : -1;
  const int charge = atom->getAtomicNum() == 7
                         ? genericCharge + 1 - (specialNitrogen ? 1 : 0)
                         : genericCharge;
  double bondOrder = 0.0;
  for (const auto bond : molecule.atomBonds(atom)) {
    bondOrder += bond->getBondTypeAsDouble();
  }
  const int integralBondOrder = static_cast<int>(bondOrder);

  // Preserve Dimorphite-DL's narrow aromatic nitrogen exception.
  if (!(atom->getAtomicNum() == 7 && charge == 1 && bondOrder == 4.0 &&
        atom->getIsAromatic() && atom->getDegree() == 3)) {
    atom->setFormalCharge(charge);
    if (atom->getAtomicNum() == 7) {
      static const std::map<std::pair<int, int>, unsigned int> hydrogenCounts = {
          {{1, 1}, 3}, {{1, 2}, 2}, {{1, 3}, 1}, {{0, 1}, 2},
          {{0, 2}, 1}, {{-1, 1}, 1}, {{-1, 2}, 0},
      };
      const auto found = hydrogenCounts.find({charge, integralBondOrder});
      if (found != hydrogenCounts.end()) atom->setNumExplicitHs(found->second);
    } else if (atom->getAtomicNum() == 8 || atom->getAtomicNum() == 16) {
      if (charge == 0 && bondOrder == 1.0) atom->setNumExplicitHs(1);
      if (charge == -1 && bondOrder == 1.0) atom->setNumExplicitHs(0);
    }
  }
  molecule.updatePropertyCache(false);
  if (RDKit::MolToSmiles(molecule).find("[nH-]") != std::string::npos) {
    atom->setNumExplicitHs(0);
    molecule.updatePropertyCache(false);
  }
}

double logAdd(double first, double second) {
  if (!std::isfinite(first)) return second;
  if (!std::isfinite(second)) return first;
  const double maximum = std::max(first, second);
  return maximum + std::log(std::exp(first - maximum) +
                            std::exp(second - maximum));
}

int totalFormalCharge(const RDKit::ROMol &molecule) {
  int charge = 0;
  for (const auto atom : molecule.atoms()) charge += atom->getFormalCharge();
  return charge;
}

bool isResonanceDeactivatedAmine(const RDKit::ROMol &molecule,
                                 unsigned int atomIndex) {
  const auto *nitrogen = molecule.getAtomWithIdx(atomIndex);
  if (nitrogen->getAtomicNum() != 7) return false;
  for (const auto bond : molecule.atomBonds(nitrogen)) {
    const auto *center = bond->getOtherAtom(nitrogen);
    if (center->getAtomicNum() != 6 && center->getAtomicNum() != 15 &&
        center->getAtomicNum() != 16) continue;
    for (const auto centerBond : molecule.atomBonds(center)) {
      const auto *terminal = centerBond->getOtherAtom(center);
      if (terminal == nitrogen) continue;
      if (centerBond->getBondTypeAsDouble() >= 1.9 &&
          (terminal->getAtomicNum() == 7 || terminal->getAtomicNum() == 8 ||
           terminal->getAtomicNum() == 16)) return true;
    }
  }
  return false;
}

double energyAt(ForceFields::ForceField &field,
                std::vector<double> &positions) {
  return field.calcEnergy(positions.data());
}

void gradientAt(ForceFields::ForceField &field,
                std::vector<double> &positions,
                std::vector<double> &gradient) {
  std::fill(gradient.begin(), gradient.end(), 0.0);
  field.calcGrad(positions.data(), gradient.data());
}

void runDynamics(RDKit::RWMol &mol, ForceFields::ForceField &field,
                 unsigned int steps, double temperature, rj::Value &frames,
                 rj::Document::AllocatorType &allocator,
                 unsigned int savedFrameCount) {
  auto positions = conformerPositions(mol);
  std::vector<double> velocities(positions.size(), 0.0);
  std::vector<double> gradient(positions.size(), 0.0);
  std::vector<double> masses(mol.getNumAtoms(), 1.0);
  std::mt19937 random(20260816);
  std::normal_distribution<double> gaussian(0.0, 1.0);

  double totalMass = 0.0;
  double momentum[3] = {0.0, 0.0, 0.0};
  for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
    masses[atom] = mol.getAtomWithIdx(atom)->getMass();
    totalMass += masses[atom];
    const double sigma = std::sqrt(kBoltzmannKcal * temperature /
                                   (masses[atom] / kForceToAcceleration));
    for (unsigned int axis = 0; axis < 3; ++axis) {
      const double value = sigma * gaussian(random);
      velocities[atom * 3 + axis] = value;
      momentum[axis] += masses[atom] * value;
    }
  }
  for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
    for (unsigned int axis = 0; axis < 3; ++axis) {
      velocities[atom * 3 + axis] -= momentum[axis] / totalMass;
    }
  }

  // Hydrogens are unconstrained, so use a conservative step. A typical 1–2 fs
  // biomolecular step assumes constrained X-H bonds; this small-molecule path
  // intentionally does not make that approximation.
  const double timestepFs = 0.1;
  const double thermostat = std::exp(-0.001 * timestepFs);
  savedFrameCount = std::max(2u, std::min(steps + 1, savedFrameCount));
  unsigned int nextFrame = 1;
  unsigned int nextSampleStep = static_cast<unsigned int>(std::lround(
      static_cast<double>(nextFrame) * steps / (savedFrameCount - 1)));
  addFrame(frames, allocator, 0, energyAt(field, positions), positions);
  gradientAt(field, positions, gradient);

  for (unsigned int step = 1; step <= steps; ++step) {
    for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
      const double accelerationScale =
          kForceToAcceleration / masses[atom];
      const double noise =
          std::sqrt((1.0 - thermostat * thermostat) * kBoltzmannKcal *
                    temperature * kForceToAcceleration / masses[atom]);
      for (unsigned int axis = 0; axis < 3; ++axis) {
        const unsigned int index = atom * 3 + axis;
        velocities[index] -=
            0.5 * timestepFs * accelerationScale * gradient[index];
        positions[index] += 0.5 * timestepFs * velocities[index];
        velocities[index] =
            thermostat * velocities[index] + noise * gaussian(random);
        positions[index] += 0.5 * timestepFs * velocities[index];
      }
    }

    gradientAt(field, positions, gradient);
    if (!finitePositions(positions) || !finitePositions(gradient)) {
      throw std::runtime_error("Dynamics became unstable at integration step " +
                               std::to_string(step));
    }
    for (unsigned int atom = 0; atom < mol.getNumAtoms(); ++atom) {
      const double accelerationScale =
          kForceToAcceleration / masses[atom];
      for (unsigned int axis = 0; axis < 3; ++axis) {
        const unsigned int index = atom * 3 + axis;
        velocities[index] -=
            0.5 * timestepFs * accelerationScale * gradient[index];
      }
    }

    if (step == nextSampleStep) {
      setConformerPositions(mol, positions);
      addFrame(frames, allocator, step, energyAt(field, positions), positions);
      nextFrame++;
      if (nextFrame < savedFrameCount) {
        nextSampleStep = static_cast<unsigned int>(std::lround(
            static_cast<double>(nextFrame) * steps / (savedFrameCount - 1)));
      }
    }
  }
  setConformerPositions(mol, positions);
}

}  // namespace

std::string JSMolBase::get_gasteiger_charges() const {
  try {
    std::vector<double> charges(get().getNumAtoms(), 0.0);
    RDKit::computeGasteigerCharges(get(), charges, 12, true);
    rj::Document result;
    result.SetArray();
    auto &allocator = result.GetAllocator();
    for (double charge : charges) {
      if (!std::isfinite(charge)) {
        throw std::runtime_error("RDKit produced a non-finite Gasteiger charge");
      }
      result.PushBack(charge, allocator);
    }
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    result.Accept(writer);
    return buffer.GetString();
  } catch (const std::exception &error) {
    rj::Document failure;
    failure.SetObject();
    auto &allocator = failure.GetAllocator();
    failure.AddMember("error", rj::Value(error.what(), allocator), allocator);
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    failure.Accept(writer);
    return buffer.GetString();
  }
}

std::string JSMolBase::enumerate_protonation_states(
    const std::string &siteData, double phMin, double phMax,
    double precision, unsigned int maxStates) const {
  try {
    if (!std::isfinite(phMin) || !std::isfinite(phMax) || phMin > phMax ||
        phMin < -100.0 || phMax > 100.0) {
      throw std::invalid_argument("The pH range is invalid");
    }
    if (!std::isfinite(precision) || precision < 0.0 || precision > 10.0) {
      throw std::invalid_argument("The pKa precision factor is invalid");
    }
    maxStates = std::max(1u, std::min(256u, maxStates));
    const auto definitions = parseIonizableDefinitions(siteData);

    RDKit::RWMol prepared(get());
    RDKit::MolOps::addHs(prepared, false, false);
    std::set<unsigned int> protectedAtoms;
    std::set<std::tuple<std::string, unsigned int, double>> uniqueActions;
    std::vector<IonizableAction> actions;
    bool sitesTruncated = false;
    constexpr unsigned int maxDetectedSites = 64;

    for (const auto &definition : definitions) {
      std::unique_ptr<RDKit::RWMol> query(
          RDKit::SmartsToMol(definition.smarts));
      if (!query) {
        throw std::runtime_error("Could not parse ionizable SMARTS " +
                                 definition.name);
      }
      RDKit::SubstructMatchParameters parameters;
      parameters.uniquify = true;
      parameters.maxMatches = 10000;
      const auto matches = RDKit::SubstructMatch(prepared, *query, parameters);
      std::vector<RDKit::MatchVectType> accepted;
      for (const auto &match : matches) {
        bool available = true;
        for (const auto &entry : match) {
          if (protectedAtoms.count(entry.second)) {
            available = false;
            break;
          }
        }
        if (available) accepted.push_back(match);
      }
      for (const auto &match : accepted) {
        std::vector<int> queryToTarget(query->getNumAtoms(), -1);
        for (const auto &entry : match) {
          if (entry.first >= 0 &&
              static_cast<unsigned int>(entry.first) < queryToTarget.size()) {
            queryToTarget[entry.first] = entry.second;
          }
        }
        for (const auto &pka : definition.pkas) {
          if (pka.queryAtom >= queryToTarget.size() ||
              queryToTarget[pka.queryAtom] < 0) {
            throw std::runtime_error("Ionizable SMARTS atom index is invalid for " +
                                     definition.name);
          }
          if (actions.size() >= maxDetectedSites) {
            sitesTruncated = true;
            continue;
          }
          const auto atom =
              static_cast<unsigned int>(queryToTarget[pka.queryAtom]);
          if (definition.name == "Amines_primary_secondary_tertiary" &&
              isResonanceDeactivatedAmine(prepared, atom)) {
            continue;
          }
          if (!uniqueActions.emplace(definition.name, atom, pka.mean).second) {
            continue;
          }
          actions.push_back({
              definition.name,
              atom,
              prepared.getAtomWithIdx(atom)->getSymbol(),
              pka.mean,
              pka.deviation,
              allowedProtonation(pka.mean, pka.deviation, phMin, phMax,
                                  precision),
          });
        }
      }
      // Definition order is chemically meaningful in Dimorphite-DL. Every
      // atom in an accepted match is unavailable to lower-priority patterns.
      for (const auto &match : accepted) {
        for (const auto &entry : match) protectedAtoms.insert(entry.second);
      }
    }

    RDKit::MolOps::RemoveHsParameters removeParameters;
    std::unique_ptr<RDKit::ROMol> stripped(
        RDKit::MolOps::removeHs(static_cast<const RDKit::ROMol &>(prepared),
                               removeParameters, true));
    if (!stripped) throw std::runtime_error("Could not remove explicit hydrogens");
    std::vector<ProtonationVariant> variants;
    variants.push_back(
        {std::make_shared<RDKit::RWMol>(*stripped), {}, 0.0, "", 0.0, 0});
    const double targetPh = 0.5 * (phMin + phMax);
    bool variantsTruncated = false;

    for (unsigned int actionIndex = 0; actionIndex < actions.size(); ++actionIndex) {
      const auto &action = actions[actionIndex];
      std::vector<bool> choices;
      if (action.allowed == AllowedProtonation::Deprotonated) choices = {false};
      else if (action.allowed == AllowedProtonation::Protonated) choices = {true};
      else choices = {false, true};

      std::map<std::string, unsigned int> canonicalToVariant;
      std::vector<ProtonationVariant> next;
      for (const auto &variant : variants) {
        for (const bool protonated : choices) {
          auto molecule = std::make_shared<RDKit::RWMol>(*variant.molecule);
          applyProtonationChoice(*molecule, action, protonated);
          const std::string smiles = RDKit::MolToSmiles(*molecule);
          const double fraction = std::max(
              std::numeric_limits<double>::min(),
              protonated ? protonatedFraction(targetPh, action.mean)
                         : 1.0 - protonatedFraction(targetPh, action.mean));
          const double logWeight = variant.logWeight + std::log(fraction);
          const auto found = canonicalToVariant.find(smiles);
          if (found != canonicalToVariant.end()) {
            auto &existing = next[found->second];
            existing.logWeight = logAdd(existing.logWeight, logWeight);
            continue;
          }
          ProtonationVariant candidate;
          candidate.molecule = std::move(molecule);
          candidate.choices = variant.choices;
          candidate.choices.push_back({actionIndex, protonated});
          candidate.logWeight = logWeight;
          candidate.smiles = smiles;
          canonicalToVariant.emplace(smiles,
                                     static_cast<unsigned int>(next.size()));
          next.push_back(std::move(candidate));
        }
      }
      if (next.empty()) {
        throw std::runtime_error("No valid protonation states remain after " +
                                 action.name);
      }
      std::stable_sort(next.begin(), next.end(),
                       [](const auto &first, const auto &second) {
                         return first.logWeight > second.logWeight;
                       });
      if (next.size() > maxStates) {
        next.resize(maxStates);
        variantsTruncated = true;
      }
      variants = std::move(next);
    }

    double maximumLogWeight = -std::numeric_limits<double>::infinity();
    for (const auto &variant : variants) {
      maximumLogWeight = std::max(maximumLogWeight, variant.logWeight);
    }
    double weightSum = 0.0;
    for (auto &variant : variants) {
      variant.population = std::exp(variant.logWeight - maximumLogWeight);
      weightSum += variant.population;
      variant.formalCharge = totalFormalCharge(*variant.molecule);
      if (variant.smiles.empty()) variant.smiles = RDKit::MolToSmiles(*variant.molecule);
    }
    for (auto &variant : variants) variant.population /= weightSum;
    std::stable_sort(variants.begin(), variants.end(),
                     [](const auto &first, const auto &second) {
                       if (first.population != second.population)
                         return first.population > second.population;
                       return first.smiles < second.smiles;
                     });

    rj::Document result;
    result.SetObject();
    auto &allocator = result.GetAllocator();
    result.AddMember("algorithm", "Dimorphite-DL-compatible empirical sites",
                     allocator);
    result.AddMember("phMin", phMin, allocator);
    result.AddMember("phMax", phMax, allocator);
    result.AddMember("targetPh", targetPh, allocator);
    result.AddMember("precision", precision, allocator);
    result.AddMember("canonicalInput",
                     rj::Value(RDKit::MolToSmiles(*stripped).c_str(), allocator),
                     allocator);
    result.AddMember("sitesTruncated", sitesTruncated, allocator);
    result.AddMember("variantsTruncated", variantsTruncated, allocator);
    result.AddMember("populationModel",
                     "independent Henderson-Hasselbalch estimate; coupled microstates are not modeled",
                     allocator);
    rj::Value siteValues(rj::kArrayType);
    for (const auto &action : actions) {
      rj::Value site(rj::kObjectType);
      site.AddMember("name", rj::Value(action.name.c_str(), allocator), allocator);
      site.AddMember("atomIndex", action.atom, allocator);
      site.AddMember("element", rj::Value(action.element.c_str(), allocator), allocator);
      site.AddMember("meanPka", action.mean, allocator);
      site.AddMember("pkaStdDev", action.deviation, allocator);
      site.AddMember("allowedState", rj::Value(allowedName(action.allowed), allocator), allocator);
      siteValues.PushBack(site, allocator);
    }
    result.AddMember("sites", siteValues, allocator);
    rj::Value stateValues(rj::kArrayType);
    for (unsigned int variantIndex = 0; variantIndex < variants.size(); ++variantIndex) {
      const auto &variant = variants[variantIndex];
      rj::Value state(rj::kObjectType);
      state.AddMember("smiles", rj::Value(variant.smiles.c_str(), allocator), allocator);
      state.AddMember("formalCharge", variant.formalCharge, allocator);
      state.AddMember("estimatedPopulation", variant.population, allocator);
      state.AddMember("recommended", variantIndex == 0, allocator);
      rj::Value choiceValues(rj::kArrayType);
      for (const auto &choice : variant.choices) {
        rj::Value value(rj::kObjectType);
        value.AddMember("siteIndex", choice.site, allocator);
        value.AddMember("protonated", choice.protonated, allocator);
        choiceValues.PushBack(value, allocator);
      }
      state.AddMember("choices", choiceValues, allocator);
      stateValues.PushBack(state, allocator);
    }
    result.AddMember("states", stateValues, allocator);
    result.AddMember("rdkitVersion", rj::Value(RDKit::rdkitVersion, allocator), allocator);
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    result.Accept(writer);
    return buffer.GetString();
  } catch (const std::exception &error) {
    rj::Document failure;
    failure.SetObject();
    auto &allocator = failure.GetAllocator();
    failure.AddMember("error", rj::Value(error.what(), allocator), allocator);
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    failure.Accept(writer);
    return buffer.GetString();
  }
}

void JSMolBase::use_mdl_aromaticity() {
  // SMIRNOFF Sage 2.1 declares OEAroModel_MDL.  Start from a Kekule form so
  // RDKit can re-perceive aromaticity under the corresponding MDL rules
  // instead of preserving the input SMILES model (notably for caffeine-like
  // fused heterocycles).
  RDKit::MolOps::Kekulize(get(), true);
  RDKit::MolOps::setAromaticity(get(), RDKit::MolOps::AROMATICITY_MDL);
  get().updatePropertyCache(false);
  // RDKit releases before 2025.09 can label pentavalent phosphorus SP3D,
  // although the built-in Gasteiger table contains the intended P(sp3) row.
  // Newer RDKit releases normalize this assignment; make that
  // behavior explicit so browser charges match the current OpenFF reference.
  for (auto atom : get().atoms()) {
    if (atom->getAtomicNum() == 15) {
      atom->setHybridization(RDKit::Atom::SP3);
    }
  }
}

std::string JSMolBase::get_smirks_matches(const JSMolBase &query) const {
  rj::Document result;
  result.SetArray();
  auto &allocator = result.GetAllocator();

  std::vector<std::pair<unsigned int, unsigned int>> mappedQueryAtoms;
  for (const auto atom : query.get().atoms()) {
    const int mapNumber = atom->getAtomMapNum();
    if (mapNumber > 0) {
      mappedQueryAtoms.emplace_back(static_cast<unsigned int>(mapNumber),
                                    atom->getIdx());
    }
  }
  std::sort(mappedQueryAtoms.begin(), mappedQueryAtoms.end());
  if (mappedQueryAtoms.empty()) {
    return "[]";
  }

  RDKit::SubstructMatchParameters parameters;
  // Force-field assignment needs every symmetry-related embedding.  RDKit's
  // default uniquification otherwise returns only one match for terms such as
  // the three angles of a cyclopropane ring.
  parameters.uniquify = false;
  parameters.maxMatches = 1000000;
  const auto matches = RDKit::SubstructMatch(get(), query.get(), parameters);
  for (const auto &match : matches) {
    std::vector<int> queryToTarget(query.get().getNumAtoms(), -1);
    for (const auto &entry : match) {
      queryToTarget.at(entry.first) = static_cast<int>(entry.second);
    }
    rj::Value mapped(rj::kArrayType);
    mapped.Reserve(static_cast<rj::SizeType>(mappedQueryAtoms.size()),
                   allocator);
    bool complete = true;
    for (const auto &entry : mappedQueryAtoms) {
      const int target = queryToTarget.at(entry.second);
      if (target < 0) {
        complete = false;
        break;
      }
      mapped.PushBack(target, allocator);
    }
    if (complete) {
      result.PushBack(mapped, allocator);
    }
  }

  rj::StringBuffer buffer;
  rj::Writer<rj::StringBuffer> writer(buffer);
  result.Accept(writer);
  return buffer.GetString();
}

std::string JSMolBase::run_forcefield(const std::string &job,
                                      unsigned int maxIterations,
                                      unsigned int snapshotFrequency,
                                      unsigned int dynamicsSteps,
                                      double temperature,
                                      unsigned int dynamicsFrameCount,
                                      const std::string &fixedAtomData) {
  try {
    auto &mol = get();
    auto parameterized = parameterize(mol);
    const auto fixedAtoms = parseFixedAtomIndices(fixedAtomData, mol.getNumAtoms());
    if (!fixedAtoms.empty() && job != "geometry") {
      throw std::invalid_argument(
          "Fixed atoms are supported only for geometry optimization");
    }
    if (job == "geometry" && fixedAtoms.size() >= mol.getNumAtoms()) {
      throw std::invalid_argument(
          "Geometry optimization requires at least one movable atom");
    }
    for (const auto atom : fixedAtoms) {
      parameterized.field->fixedPoints().push_back(atom);
    }
    auto initialPositions = conformerPositions(mol);
    const double initialEnergy =
        energyAt(*parameterized.field, initialPositions);
    if (!std::isfinite(initialEnergy)) {
      throw std::runtime_error("The starting force-field energy is not finite");
    }

    rj::Document result;
    result.SetObject();
    auto &allocator = result.GetAllocator();
    result.AddMember("forcefield",
                     rj::Value(parameterized.name.c_str(), allocator),
                     allocator);
    result.AddMember("fallback", parameterized.fallback, allocator);
    result.AddMember("rdkitVersion", rj::Value(RDKit::rdkitVersion, allocator),
                     allocator);
    result.AddMember("initialEnergy", initialEnergy, allocator);
    result.AddMember("fixedAtomCount",
                     static_cast<unsigned int>(fixedAtoms.size()), allocator);
    result.AddMember("movableAtomCount",
                     mol.getNumAtoms() - static_cast<unsigned int>(fixedAtoms.size()),
                     allocator);
    rj::Value frames(rj::kArrayType);

    int status = 0;
    double finalEnergy = initialEnergy;
    auto finalPositions = initialPositions;
    if (job == "geometry") {
      addFrame(frames, allocator, 0, initialEnergy, initialPositions);
      auto *snapshots = new RDKit::SnapshotVect();
      status = parameterized.field->minimize(
          std::max(1u, snapshotFrequency), snapshots,
          std::max(1u, maxIterations), 1e-4, 1e-6);
      RDKit::Trajectory trajectory(3, mol.getNumAtoms(), snapshots);
      for (unsigned int index = 0; index < trajectory.size(); ++index) {
        const auto &snapshot = trajectory.getSnapshot(index);
        const double snapshotEnergy = snapshot.getEnergy();
        auto positions = snapshotPositions(snapshot, mol.getNumAtoms());
        if (!std::isfinite(snapshotEnergy) || !finitePositions(positions)) {
          continue;
        }
        addFrame(frames, allocator,
                 std::min(maxIterations,
                          (index + 1) * std::max(1u, snapshotFrequency)),
                 snapshotEnergy, positions);
        if (snapshotEnergy < finalEnergy) {
          finalEnergy = snapshotEnergy;
          finalPositions = std::move(positions);
        }
      }
      auto candidatePositions = conformerPositions(mol);
      const double candidateEnergy =
          energyAt(*parameterized.field, candidatePositions);
      if (std::isfinite(candidateEnergy) &&
          finitePositions(candidatePositions) && candidateEnergy < finalEnergy) {
        finalEnergy = candidateEnergy;
        finalPositions = std::move(candidatePositions);
      }
      setConformerPositions(mol, finalPositions);
    } else if (job == "dynamics") {
      runDynamics(mol, *parameterized.field, std::max(1u, dynamicsSteps),
                  temperature, frames, allocator, dynamicsFrameCount);
      finalPositions = conformerPositions(mol);
      finalEnergy = energyAt(*parameterized.field, finalPositions);
    } else if (job != "energy") {
      throw std::invalid_argument("Unknown force-field job");
    }

    if (!std::isfinite(finalEnergy)) {
      throw std::runtime_error("The final force-field energy is not finite");
    }
    if (job == "geometry") {
      addFrame(frames, allocator, maxIterations, finalEnergy, finalPositions);
    } else if (job == "energy") {
      addFrame(frames, allocator, 0, finalEnergy, finalPositions);
    }
    result.AddMember("finalEnergy", finalEnergy, allocator);
    result.AddMember("converged", status == 0, allocator);
    result.AddMember("frames", frames, allocator);

    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    result.Accept(writer);
    return buffer.GetString();
  } catch (const std::exception &error) {
    rj::Document failure;
    failure.SetObject();
    auto &allocator = failure.GetAllocator();
    failure.AddMember("error", rj::Value(error.what(), allocator), allocator);
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    failure.Accept(writer);
    return buffer.GetString();
  }
}

std::string JSMolBase::generate_conformers(unsigned int requestedCount,
                                           int randomSeed,
                                           double pruneRmsThreshold,
                                           unsigned int minimizeIterations) {
  try {
    if (requestedCount < 1 || requestedCount > 256) {
      throw std::invalid_argument(
          "ETKDG conformer count must be between 1 and 256");
    }
    if (!std::isfinite(pruneRmsThreshold) || pruneRmsThreshold < 0.0 ||
        pruneRmsThreshold > 5.0) {
      throw std::invalid_argument(
          "ETKDG pruning threshold must be between 0 and 5 angstrom");
    }

    auto &mol = get();
    auto parameters = RDKit::DGeomHelpers::ETKDGv3;
    parameters.randomSeed = randomSeed;
    parameters.numThreads = 1;
    parameters.clearConfs = true;
    parameters.pruneRmsThresh = pruneRmsThreshold;
    parameters.onlyHeavyAtomsForRMS = true;
    parameters.useSymmetryForPruning = true;
    parameters.symmetrizeConjugatedTerminalGroupsForPruning = true;
    auto conformerIds = RDKit::DGeomHelpers::EmbedMultipleConfs(
        mol, requestedCount, parameters);
    if (conformerIds.empty()) {
      parameters.useRandomCoords = true;
      parameters.clearConfs = true;
      conformerIds = RDKit::DGeomHelpers::EmbedMultipleConfs(
          mol, requestedCount, parameters);
    }
    if (conformerIds.empty()) {
      throw std::runtime_error("ETKDGv3 could not embed this molecule");
    }

    rj::Document result;
    result.SetObject();
    auto &allocator = result.GetAllocator();
    result.AddMember("method", "ETKDGv3", allocator);
    result.AddMember("requestedCount", requestedCount, allocator);
    result.AddMember("embeddedCount",
                     static_cast<unsigned int>(conformerIds.size()), allocator);
    result.AddMember("randomSeed", randomSeed, allocator);
    result.AddMember("pruneRmsThreshold", pruneRmsThreshold, allocator);
    rj::Value conformers(rj::kArrayType);
    std::string preparationForcefield;
    unsigned int minimizedCount = 0;
    for (int conformerId : conformerIds) {
      if (minimizeIterations) {
        try {
          auto parameterized = parameterize(mol, conformerId);
          parameterized.field->minimize(minimizeIterations, 1e-4, 1e-6);
          preparationForcefield = parameterized.name;
          minimizedCount++;
        } catch (const std::exception &) {
          // ETKDG coordinates remain valid seeds when a polishing force field
          // does not cover a molecule. Sage is still used for the search.
        }
      }
      auto positions = conformerPositions(mol, conformerId);
      if (!finitePositions(positions)) {
        throw std::runtime_error("ETKDGv3 returned non-finite coordinates");
      }
      addPositions(conformers, allocator, positions);
    }
    result.AddMember("minimizedCount", minimizedCount, allocator);
    result.AddMember(
        "preparationForcefield",
        rj::Value(preparationForcefield.empty() ? "ETKDGv3" :
                  preparationForcefield.c_str(), allocator), allocator);
    result.AddMember("conformers", conformers, allocator);

    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    result.Accept(writer);
    return buffer.GetString();
  } catch (const std::exception &error) {
    rj::Document failure;
    failure.SetObject();
    auto &allocator = failure.GetAllocator();
    failure.AddMember("error", rj::Value(error.what(), allocator), allocator);
    rj::StringBuffer buffer;
    rj::Writer<rj::StringBuffer> writer(buffer);
    failure.Accept(writer);
    return buffer.GetString();
  }
}
