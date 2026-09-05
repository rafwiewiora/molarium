#!/usr/bin/env python3
"""Independent native OpenMM oracle. No Molarium C++/WASM bridge is imported."""
import argparse
import hashlib
import json
import math
import platform
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import openmm as mm
from openmm import unit

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def build(case, rounded=False):
    """Use the exact exported terms; never infer bonds, charges or exclusions."""
    q = f32 if rounded else float
    numeric = case['configuredSystem']
    system = mm.System()
    for row in numeric['particles']:
        system.addParticle(row['mass_amu'])
    for row in numeric['constraints']:
        system.addConstraint(row['i'], row['j'], q(row['distance_nm']))
    bonds, angles, torsions = mm.HarmonicBondForce(), mm.HarmonicAngleForce(), mm.PeriodicTorsionForce()
    for r in numeric['bonds']:
        bonds.addBond(r['i'], r['j'], q(r['r0_nm']), q(r['k_kj_nm2']))
    for r in numeric['angles']:
        angles.addAngle(r['i'], r['j'], r['k'], q(r['theta0_rad']), q(r['k_kj_rad2']))
    for r in numeric['torsions']:
        torsions.addTorsion(r['i'], r['j'], r['k'], r['l'], r['periodicity'], q(r['phase_rad']), q(r['k_kj']))
    nb = mm.NonbondedForce()
    cutoff = q(case['options'].get('cutoffNm', 0))
    nb.setNonbondedMethod(mm.NonbondedForce.CutoffNonPeriodic if cutoff else mm.NonbondedForce.NoCutoff)
    if cutoff:
        nb.setCutoffDistance(cutoff)
    nb.setReactionFieldDielectric(1.0)  # production: q_i*q_j*(1/r - 1/rc), not solvent RF
    nb.setUseDispersionCorrection(False)
    nb.setUseSwitchingFunction(False)
    for r in numeric['nonbonded']:
        nb.addParticle(q(r['charge_e']), q(r['sigma_nm']), q(r['epsilon_kj']))
    for r in numeric['exceptions']:
        nb.addException(r['i'], r['j'], q(r['chargeprod_e2']), q(r['sigma_nm']), q(r['epsilon_kj']))
    forces = [('bond', bonds), ('angle', angles), ('torsion', torsions), ('nonbonded', nb)]
    implicit = case['implicitSolvent']
    if implicit:
        gb = mm.GBSAOBCForce()
        gb.setSolventDielectric(implicit['solventDielectric'])
        gb.setSoluteDielectric(implicit['soluteDielectric'])
        gb.setSurfaceAreaEnergy(implicit['surfaceAreaEnergyKjNm2'])
        gb.setNonbondedMethod(mm.GBSAOBCForce.CutoffNonPeriodic if cutoff else mm.GBSAOBCForce.NoCutoff)
        if cutoff:
            gb.setCutoffDistance(cutoff)
        for r in implicit['particles']:
            gb.addParticle(q(r['charge_e']), q(r['radius_nm']), q(r['scale']))
        forces.append(('obc2', gb))
    for group, (_, force) in enumerate(forces):
        force.setForceGroup(group)
        system.addForce(force)
    positions = [[q(float(a[axis])*0.1) for axis in ('x','y','z')] for a in case['molecule']['atoms']]
    return system, positions, [name for name, _ in forces]


def state_result(context, names):
    state = context.getState(getEnergy=True, getForces=True)
    energy = state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
    forces = state.getForces(asNumpy=True).value_in_unit(unit.kilojoule_per_mole/unit.nanometer).reshape(-1).tolist()
    components = {name: context.getState(getEnergy=True, groups=1 << group)
                  .getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole) for group, name in enumerate(names)}
    if not all(math.isfinite(v) for v in [energy, *forces, *components.values()]):
        raise ValueError('Non-finite native energy or force')
    return {'energy': energy, 'forces': forces, 'components': components}


def properties_for(platform_object, precision, device):
    names = platform_object.getPropertyNames()
    props = {'Precision': precision} if 'Precision' in names else {}
    if device is not None and 'DeviceIndex' in names:
        props['DeviceIndex'] = device
    if 'Threads' in names:
        props['Threads'] = '1'
    return props


def accuracy(case, platform_object, properties, rounded):
    system, positions, names = build(case, rounded)
    integrator = mm.VerletIntegrator(0.001)
    context = mm.Context(system, integrator, platform_object, properties)
    context.setPositions(positions)
    result = state_result(context, names)
    result['platformProperties'] = {k: platform_object.getPropertyValue(context, k)
                                    for k in platform_object.getPropertyNames()}
    del context, integrator
    return result


def timing(case, platform_object, properties, protocol, repeats, seconds):
    p = protocol['performance']
    dt = p['timestepPs']
    steps = p['mdStepsPerJob']
    system, positions, names = build(case, False)
    # This is deliberately labelled: OpenMM LangevinIntegrator is not the
    # WebGPU worker's integration algorithm or random stream.
    integrator = mm.LangevinIntegrator(p['temperatureK'], p['frictionPerPs'], dt)
    integrator.setRandomNumberSeed(20260816)
    integrator.setConstraintTolerance(1e-5)
    context = mm.Context(system, integrator, platform_object, properties)
    results = {}
    for job in ('energy', 'dynamics'):
        samples = []
        for repeat in range(-p['warmups'], repeats):
            context.setPositions(positions)
            context.setVelocitiesToTemperature(p['temperatureK'], 20260816)
            context.getState(getEnergy=True)  # synchronize and compile outside timing
            count = 0
            started = time.perf_counter()
            while time.perf_counter() - started < seconds or count == 0:
                if job == 'dynamics':
                    integrator.step(steps)
                    state = context.getState(getEnergy=True, getPositions=True)
                    energy = state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
                    if not math.isfinite(energy):
                        raise ValueError('Non-finite trajectory endpoint')
                else:
                    state = context.getState(getEnergy=True, getForces=True)
                    if not math.isfinite(state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)):
                        raise ValueError('Non-finite energy sample')
                count += 1
            elapsed = time.perf_counter() - started
            if repeat >= 0:
                samples.append({'seconds': elapsed, 'jobs': count, 'msPerJob': elapsed*1000/count,
                                'stepsPerSecond': count*steps/elapsed if job == 'dynamics' else None,
                                'nsPerDay': count*steps*dt*86.4/elapsed if job == 'dynamics' else None})
        results[job] = {'scope': 'resident native Context including requested state readback', 'samples': samples}
    del context, integrator
    return {'integrator': 'OpenMM LangevinIntegrator', 'sameIntegratorAsWebgpu': False, **results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--packet', type=Path, default=ROOT/'benchmarks/simulation/generated/packet.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--platform', default='Reference')
    parser.add_argument('--precision', choices=['single','mixed','double'], default='double')
    parser.add_argument('--device')
    parser.add_argument('--speed', action='store_true')
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--seconds', type=float, default=2)
    parser.add_argument('--case', action='append', help='Select exact case IDs; omitted runs the full packet')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; create a new immutable attempt')
    if args.repeats < 1 or args.seconds <= 0:
        parser.error('Positive repeats and seconds required')
    packet_bytes = args.packet.read_bytes()
    packet = json.loads(packet_bytes)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    packet_copy = args.output.parent/f'packet-{sha(packet_bytes)}.json'
    if not packet_copy.exists():
        with packet_copy.open('xb') as stream:
            stream.write(packet_bytes)
    selected = [c for c in packet['cases'] if not args.case or c['id'] in args.case]
    if not selected or (args.case and set(args.case) != {c['id'] for c in selected}):
        parser.error('Unknown/empty case selection')
    report = {'schema':'molarium.native-openmm-benchmark/v1', 'packetSha256':sha(packet_bytes),
              'sourceSha256':sha(Path(__file__).read_bytes()), 'protocolSha256':packet['protocolSha256'],
              'environment':{'openmm':mm.version.version,'numpy':np.__version__,'python':sys.version,
                             'os':platform.platform(),'machine':platform.machine(),
                             'availablePlatforms':[mm.Platform.getPlatform(i).getName() for i in range(mm.Platform.getNumPlatforms())]},
              'command':sys.argv[1:], 'platform':args.platform,'precisionRequested':args.precision,
              'performanceSettings':{'repeats':args.repeats,'minimumSampleSeconds':args.seconds},'cases':[]}
    try:
        p = mm.Platform.getPlatformByName(args.platform)
        props = properties_for(p,args.precision,args.device)
        for case in selected:
            row = {'id':case['id'],'atomCount':len(case['molecule']['atoms'])}
            try:
                row['original'] = accuracy(case,p,props,False)
                row['rounded'] = accuracy(case,p,props,True)
                row['status'] = 'ok'
                if args.speed and case.get('performance'):
                    row['performance'] = timing(case,p,props,packet['protocol'],args.repeats,args.seconds)
            except Exception as error:
                row.update(status='error',error=str(error))
            report['cases'].append(row)
            print(f"{case['id']}: {row['status']}",flush=True)
    except Exception as error:
        report['error'] = str(error)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x') as stream:
        json.dump(report,stream,indent=2,allow_nan=False); stream.write('\n')
    if report.get('error') or any(c['status'] != 'ok' for c in report['cases']):
        sys.exit(1)


if __name__ == '__main__':
    main()
