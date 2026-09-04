const SELECTION_ACTIONS = Object.freeze({
  setAtom:'chemistry.setAtom', setBond:'chemistry.setBond',
  deleteAtom:'chemistry.deleteAtom', deleteBond:'chemistry.deleteBond',
  addHydrogen:'chemistry.addHydrogen', removeHydrogen:'chemistry.removeHydrogen',
});
const ELEMENTS = new Set(['C','N','O','S','P','F','Cl','Br','I']);
const BOND_ORDERS = new Set([1,1.5,2,3]);

function assertName(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function validateEnumerationPlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.operations))
    throw new Error('Enumeration plan must contain an operations array');
  const aliases = new Set();
  let pending = 0;
  for (const [index, operation] of plan.operations.entries()) {
    const where = `operation ${index + 1}`;
    if (!operation || typeof operation !== 'object') throw new Error(`${where} must be an object`);
    if (operation.op === 'finish') {
      if (!pending) throw new Error(`${where} cannot finish an empty chemistry batch`);
      pending = 0; continue;
    }
    pending += 1;
    if (operation.op === 'addAtom') {
      assertName(operation.attachedTo, `${where}.attachedTo`);
      assertName(operation.element, `${where}.element`);
      if (!ELEMENTS.has(operation.element))
        throw new Error(`${where}.element is not a supported heavy atom`);
      assertName(operation.as, `${where}.as`);
      if (aliases.has(operation.as)) throw new Error(`${where} reuses alias ${operation.as}`);
      aliases.add(operation.as); continue;
    }
    if (operation.op === 'createBond' || operation.op === 'setBond'
      || operation.op === 'deleteBond') {
      if (!Array.isArray(operation.atoms) || operation.atoms.length !== 2)
        throw new Error(`${where}.atoms must contain exactly two atom references`);
      operation.atoms.forEach((value) => assertName(value, `${where}.atoms`));
      if (operation.op !== 'deleteBond' && !BOND_ORDERS.has(Number(operation.order)))
        throw new Error(`${where}.order must be 1, 1.5, 2, or 3`);
      continue;
    }
    if (Object.hasOwn(SELECTION_ACTIONS, operation.op)) {
      assertName(operation.atom, `${where}.atom`);
      if (operation.op === 'setAtom') {
        if (!ELEMENTS.has(operation.element))
          throw new Error(`${where}.element is not a supported heavy atom`);
        const formalCharge = operation.formalCharge ?? 0;
        if (!Number.isInteger(formalCharge) || formalCharge < -4 || formalCharge > 4)
          throw new Error(`${where}.formalCharge must be an integer from -4 to 4`);
      }
      continue;
    }
    throw new Error(`${where} has unsupported operation ${operation.op}`);
  }
  if (pending) throw new Error('Enumeration plan must finish its final chemistry batch');
  return plan;
}

/** Execute an enumeration using only the frozen public Chemist Actions API. */
export async function executeEnumerationPlan(api, plan, { maximumAtoms = 500 } = {}) {
  validateEnumerationPlan(plan);
  if (!api || typeof api.execute !== 'function') throw new Error('A Chemist Actions API is required');
  const aliases = new Map();
  const audit = [];
  const inspect = async () => (await api.execute({ action:'session.inspect',
    args:{ scope:'ligand', includeCoordinates:false, maximumAtoms } })).result;
  const resolve = async (reference) => {
    if (aliases.has(reference)) return aliases.get(reference);
    const state = await inspect();
    const matches = state.atoms.filter((atom) => atom.atomName === reference || atom.atomId === reference);
    if (matches.length !== 1) throw new Error(`Atom reference ${reference} resolved to ${matches.length} atoms`);
    return matches[0].atomId;
  };
  const execute = async (action, args = {}) => {
    const envelope = await api.execute({ action, args }); audit.push(envelope); return envelope.result;
  };

  for (const operation of plan.operations) {
    if (operation.op === 'finish') { await execute('chemistry.finish'); continue; }
    if (operation.op === 'addAtom') {
      const result = await execute('chemistry.addAtom', {
        attachedToAtomId:await resolve(operation.attachedTo), element:operation.element,
      });
      if (!result.addedAtomId) throw new Error(`Adding ${operation.as} did not return a persistent atom ID`);
      aliases.set(operation.as, result.addedAtomId); continue;
    }
    if (operation.op === 'createBond') {
      await execute('chemistry.createBond', {
        atomIds:await Promise.all(operation.atoms.map(resolve)), order:operation.order,
      }); continue;
    }
    const atomReferences = operation.atoms || [operation.atom];
    const target = await Promise.all(atomReferences.map(resolve));
    await execute('selection.replace', { atomIds:target });
    const action = SELECTION_ACTIONS[operation.op];
    const args = operation.op === 'setAtom'
      ? { atomId:target[0], element:operation.element, formalCharge:operation.formalCharge ?? 0 }
      : operation.op === 'setBond' ? { atomIds:target, order:operation.order }
        : target.length === 1 ? { atomId:target[0] } : { atomIds:target };
    await execute(action, args);
  }
  return { schema:'molarium.enumeration-execution/v1', aliases:Object.fromEntries(aliases),
    audit, finalInspection:await inspect() };
}
