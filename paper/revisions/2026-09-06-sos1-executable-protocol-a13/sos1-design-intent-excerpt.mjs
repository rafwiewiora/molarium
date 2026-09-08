// Preconditions: prepared AWW graph in the registered SOS1 route,
// a captured propagation reference, and no prior manual contacts.
// The full release script supplies preparation and later calculations.
export async function specifyAwwIntent(api) {
  const call = async (action, args) => {
    const reply = await api.execute({action, args});
    if (reply.status !== "completed") throw Error(action + " failed");
    return reply.result;
  };
  const L = atomName => ({componentId:"heterogen:A:1104::AWW", atomName});
  const R = (residueName, residueIndex, atomName) =>
    ({residueName, chain:"A", residueIndex, insertionCode:"", atomName});

  await call("pose.addContact", {
    ligandAtom:L("N7"), ligandRole:"donor",
    receptorAtom:R("ASN", 879, "OD1")
  });
  const tyr = await call("pose.addContact", {
    ligandAtom:L("OX3"), ligandRole:"donor",
    receptorAtom:R("TYR", 884, "O")
  });
  await call("geometry.alignBranchToContact", {
    contactId:tyr.contact.contactId,
    solution:"best-directional",
    axisAtomSelectors:[L("C12"), L("C15")],
    designerPrimaryRotationDegrees:150,
    upstreamAxisAtomSelectors:[L("N7"), L("C12")],
    upstreamRotationRangeDegrees:[0, 60],
    coupledAxisAtomSelectors:[
      [L("CX4"), L("CX5")], [L("CX15"), L("CX16")]
    ],
    allowedResponseAtoms:["CG", "CD1", "CD2", "CE1", "CE2", "CZ"]
      .map(name => R("PHE", 890, name))
  });
  await call("pose.setDesignerLigandPoseFixed", {
    fixed:true,
    label:"AWW +150 degree contact-directed ligand intent before Phe890 response"
  });
}
