#!/usr/bin/env python3
"""Reproduce the pinned OpenMM gbsa numeric System, without running downloaded code."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen
import openmm as mm
from openmm import app, unit

ROOT = Path(__file__).resolve().parent
COMMIT = '0da03998df892bbb0a954ad3767c30a0cc53a11c'
BASE = f'https://raw.githubusercontent.com/openmm/openmm/{COMMIT}/examples/benchmarks/'


def main():
    out = ROOT/'generated'
    out.mkdir(exist_ok=True)
    provenance = []
    for name in ['benchmark.py', '5dfr_minimized.pdb']:
        data = urlopen(BASE+name,timeout=60).read()
        path = out/name
        if path.exists() and path.read_bytes() != data:
            raise ValueError('Pinned upstream content changed: '+name)
        path.write_bytes(data)
        provenance.append({'url':BASE+name,'sha256':hashlib.sha256(data).hexdigest()})
    pdb = app.PDBFile(str(out/'5dfr_minimized.pdb'))
    ff = app.ForceField('amber99sb.xml','amber99_obc.xml')
    system = ff.createSystem(pdb.topology,nonbondedMethod=app.CutoffNonPeriodic,
                             nonbondedCutoff=2*unit.nanometer,constraints=app.HBonds,
                             hydrogenMass=1.5*unit.amu)
    numeric = {'particles':[], 'constraints':[], 'bonds':[], 'angles':[],
               'torsions':[], 'nonbonded':[], 'exceptions':[]}
    for i in range(system.getNumParticles()):
        if system.isVirtualSite(i):
            raise ValueError('Virtual site cannot be represented by production WebGPU')
        numeric['particles'].append({'mass_amu':system.getParticleMass(i).value_in_unit(unit.amu)})
    for i in range(system.getNumConstraints()):
        a,b,d = system.getConstraintParameters(i)
        numeric['constraints'].append({'i':a,'j':b,'distance_nm':d.value_in_unit(unit.nanometer)})
    gb = None
    omitted = []
    for force in system.getForces():
        if isinstance(force,mm.HarmonicBondForce):
            for i in range(force.getNumBonds()):
                a,b,r,k = force.getBondParameters(i)
                numeric['bonds'].append({'i':a,'j':b,'r0_nm':r.value_in_unit(unit.nanometer),
                                        'k_kj_nm2':k.value_in_unit(unit.kilojoule_per_mole/unit.nanometer**2)})
        elif isinstance(force,mm.HarmonicAngleForce):
            for i in range(force.getNumAngles()):
                a,b,c,t,k = force.getAngleParameters(i)
                numeric['angles'].append({'i':a,'j':b,'k':c,'theta0_rad':t.value_in_unit(unit.radian),
                                         'k_kj_rad2':k.value_in_unit(unit.kilojoule_per_mole/unit.radian**2)})
        elif isinstance(force,mm.PeriodicTorsionForce):
            for i in range(force.getNumTorsions()):
                a,b,c,d,n,p,k = force.getTorsionParameters(i)
                numeric['torsions'].append({'i':a,'j':b,'k':c,'l':d,'periodicity':n,
                    'phase_rad':p.value_in_unit(unit.radian),'k_kj':k.value_in_unit(unit.kilojoule_per_mole)})
        elif isinstance(force,mm.NonbondedForce):
            if force.getReactionFieldDielectric() != 1 or force.getUseSwitchingFunction():
                raise ValueError('Upstream nonbonded convention differs from WebGPU')
            for i in range(force.getNumParticles()):
                q,s,e = force.getParticleParameters(i)
                numeric['nonbonded'].append({'charge_e':q.value_in_unit(unit.elementary_charge),
                    'sigma_nm':s.value_in_unit(unit.nanometer),'epsilon_kj':e.value_in_unit(unit.kilojoule_per_mole)})
            for i in range(force.getNumExceptions()):
                a,b,q,s,e = force.getExceptionParameters(i)
                numeric['exceptions'].append({'i':a,'j':b,'chargeprod_e2':q.value_in_unit(unit.elementary_charge**2),
                    'sigma_nm':s.value_in_unit(unit.nanometer),'epsilon_kj':e.value_in_unit(unit.kilojoule_per_mole)})
        elif isinstance(force,mm.GBSAOBCForce):
            gb = {'model':'OBC2','solventDielectric':force.getSolventDielectric(),
                  'soluteDielectric':force.getSoluteDielectric(),
                  'surfaceAreaEnergyKjNm2':force.getSurfaceAreaEnergy().value_in_unit(unit.kilojoule_per_mole/unit.nanometer**2),
                  'radiusOffsetNm':0.009,'particles':[]}
            for i in range(force.getNumParticles()):
                q,r,s = force.getParticleParameters(i)
                gb['particles'].append({'charge_e':q.value_in_unit(unit.elementary_charge),
                    'radius_nm':r.value_in_unit(unit.nanometer),'scale':s})
        elif isinstance(force,mm.CMMotionRemover):
            omitted.append({'force':'CMMotionRemover','reason':'zero potential energy and zero Cartesian force; dynamics are not an exact upstream integrator reproduction'})
        else:
            raise ValueError('Unrepresentable upstream force: '+type(force).__name__)
    if gb is None:
        raise ValueError('Expected built-in OBC2, not a custom GB substitute')
    xyz = pdb.positions.value_in_unit(unit.angstrom)
    atoms = [{'element':a.element.symbol,'atomName':a.name,'residueName':a.residue.name,
              'x':xyz[a.index][0],'y':xyz[a.index][1],'z':xyz[a.index][2]} for a in pdb.topology.atoms()]
    molecule = {'atoms':atoms,'bonds':[{'a':a.index,'b':b.index,'order':1} for a,b in pdb.topology.bonds()],
                'parameterization':{'forcefield':'OpenMM benchmark AMBER99SB/OBC2','chargeModel':'AMBER99SB',
                                    'system':numeric,'implicitSolvent':gb}}
    # Serialize the actual upstream System for audit and independent replay.
    xml = mm.XmlSerializer.serialize(system).encode()
    (out/'openmm-dhfr-gbsa.xml').write_bytes(xml)
    sources = {'upstreamCommit':COMMIT,'files':provenance,'openmm':mm.version.version,
               'systemXmlSha256':hashlib.sha256(xml).hexdigest(),'omittedZeroEnergyForces':omitted,
               'forcefieldFiles':[]}
    for name in ['amber99sb.xml','amber99_obc.xml']:
        data = (Path(app.__file__).parent/'data'/name).read_bytes()
        sources['forcefieldFiles'].append({'name':name,'sha256':hashlib.sha256(data).hexdigest()})
    (out/'openmm-dhfr-gbsa.json').write_text(json.dumps({'source':sources,'molecule':molecule,'implicitSolvent':gb})+'\n')
    print(f'Exported upstream DHFR gbsa: {len(atoms)} atoms, {len(numeric["constraints"])} constraints')


if __name__ == '__main__':
    main()
