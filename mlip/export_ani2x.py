#!/usr/bin/env python3
"""Export the official TorchANI ANI-2x ensemble for browser inference.

The browser computes ANI atomic-environment vectors (and their coordinate
derivatives) itself.  Each exported ONNX graph evaluates all eight atomic
networks for one element and returns both member energies and the ensemble-
mean derivative with respect to the AEV.  Keeping the descriptor outside the
graph makes analytical coordinate forces possible in ONNX Runtime Web.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import torch
import torchani


SYMBOLS = ("H", "C", "N", "O", "S", "F", "Cl")
ATOMIC_NUMBERS = (1, 6, 7, 8, 16, 9, 17)
ENSEMBLE_SIZE = 8
AEV_LENGTH = 1008


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class GraphBuilder:
    def __init__(self) -> None:
        self.nodes: list[onnx.NodeProto] = []
        self.initializers: list[onnx.TensorProto] = []

    def tensor(self, name: str, value: np.ndarray | Iterable[float]) -> str:
        array = np.asarray(value, dtype=np.float32)
        self.initializers.append(numpy_helper.from_array(array, name))
        return name

    def node(self, op: str, inputs: list[str], output: str, **attrs: object) -> str:
        self.nodes.append(helper.make_node(op, inputs, [output], **attrs))
        return output

    def linear(self, value: str, layer: torch.nn.Linear, prefix: str) -> str:
        weight = self.tensor(f"{prefix}_weight_t", layer.weight.detach().cpu().numpy().T)
        bias = self.tensor(f"{prefix}_bias", layer.bias.detach().cpu().numpy())
        product = self.node("MatMul", [value, weight], f"{prefix}_matmul")
        return self.node("Add", [product, bias], f"{prefix}_z")

    def celu(self, value: str, prefix: str) -> str:
        scaled = self.node("Div", [value, "alpha"], f"{prefix}_scaled")
        exponential = self.node("Exp", [scaled], f"{prefix}_exp")
        shifted = self.node("Sub", [exponential, "one"], f"{prefix}_shifted")
        negative = self.node("Mul", [shifted, "alpha"], f"{prefix}_negative")
        positive = self.node("Greater", [value, "zero"], f"{prefix}_positive")
        return self.node("Where", [positive, value, negative], f"{prefix}_activation")

    def celu_derivative(self, value: str, prefix: str) -> str:
        scaled = self.node("Div", [value, "alpha"], f"{prefix}_grad_scaled")
        exponential = self.node("Exp", [scaled], f"{prefix}_grad_exp")
        positive = self.node("Greater", [value, "zero"], f"{prefix}_grad_positive")
        return self.node("Where", [positive, "one", exponential], f"{prefix}_derivative")


def export_element(model: torchani.arch.ANI, symbol: str, output: Path) -> None:
    graph = GraphBuilder()
    graph.tensor("zero", [0.0])
    graph.tensor("one", [1.0])
    graph.tensor("alpha", [0.1])
    graph.tensor("ensemble_scale", [1.0 / ENSEMBLE_SIZE])
    member_energies: list[str] = []
    member_gradients: list[str] = []

    for member_index, member in enumerate(model.neural_networks.members):
        network = member.atomics[symbol]
        prefix = f"m{member_index}_{symbol.lower()}"
        hidden = "aev"
        preactivations: list[str] = []
        for layer_index, layer in enumerate(network.layers):
            z = graph.linear(hidden, layer, f"{prefix}_l{layer_index}")
            preactivations.append(z)
            hidden = graph.celu(z, f"{prefix}_l{layer_index}")
        energy = graph.linear(hidden, network.final_layer, f"{prefix}_out")
        member_energies.append(energy)

        final_weight = graph.tensor(
            f"{prefix}_out_weight",
            network.final_layer.weight.detach().cpu().numpy(),
        )
        ones = graph.node("Shape", [energy], f"{prefix}_energy_shape")
        # MatMul(ones_like(E), W_final) broadcasts the output derivative over atoms.
        energy_ones = graph.node("ConstantOfShape", [ones], f"{prefix}_energy_ones", value=numpy_helper.from_array(np.asarray([1.0], dtype=np.float32)))
        gradient = graph.node("MatMul", [energy_ones, final_weight], f"{prefix}_grad_h2")
        for layer_index in reversed(range(len(network.layers))):
            derivative = graph.celu_derivative(
                preactivations[layer_index], f"{prefix}_l{layer_index}")
            gradient_z = graph.node(
                "Mul", [gradient, derivative], f"{prefix}_grad_z{layer_index}")
            weight = graph.tensor(
                f"{prefix}_l{layer_index}_weight",
                network.layers[layer_index].weight.detach().cpu().numpy(),
            )
            gradient = graph.node(
                "MatMul", [gradient_z, weight], f"{prefix}_grad_h{layer_index - 1}")
        member_gradients.append(gradient)

    member_matrix = graph.node(
        "Concat", member_energies, "member_atomic_energies", axis=1)
    gradient_sum = member_gradients[0]
    for index, gradient in enumerate(member_gradients[1:], start=1):
        gradient_sum = graph.node(
            "Add", [gradient_sum, gradient], f"gradient_sum_{index}")
    mean_gradient = graph.node(
        "Mul", [gradient_sum, "ensemble_scale"], "aev_gradients")

    onnx_graph = helper.make_graph(
        graph.nodes,
        f"TorchANI ANI-2x {symbol} atomic ensemble",
        [helper.make_tensor_value_info("aev", TensorProto.FLOAT, ["atoms", AEV_LENGTH])],
        [
            helper.make_tensor_value_info(member_matrix, TensorProto.FLOAT, ["atoms", ENSEMBLE_SIZE]),
            helper.make_tensor_value_info(mean_gradient, TensorProto.FLOAT, ["atoms", AEV_LENGTH]),
        ],
        graph.initializers,
    )
    artifact = helper.make_model(
        onnx_graph,
        producer_name="Molarium TorchANI exporter",
        producer_version="1",
        opset_imports=[helper.make_opsetid("", 18)],
        ir_version=9,
    )
    artifact.doc_string = (
        "Official TorchANI ANI-2x atomic networks. Input is an ANI-2x AEV; "
        "outputs are eight member atomic energies and the mean dE/dAEV."
    )
    onnx.checker.check_model(artifact)
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(artifact, output)


GOLDEN_MOLECULES = {
    "water": ([8, 1, 1], [[0.0000, 0.0000, 0.0000], [0.9572, 0.0000, 0.0000], [-0.2390, 0.9270, 0.0000]]),
    "ethanol": ([6, 6, 8, 1, 1, 1, 1, 1, 1], [[-0.748, 0.014, 0.024], [0.748, -0.014, -0.024], [1.373, 1.208, 0.239], [-1.100, -0.901, -0.467], [-1.127, 0.878, -0.499], [-1.105, 0.050, 1.058], [1.105, -0.050, -1.058], [1.116, -0.873, 0.537], [2.323, 1.142, 0.170]]),
    "methylamine": ([6, 7, 1, 1, 1, 1, 1], [[-0.700, 0.000, 0.000], [0.750, 0.000, 0.000], [-1.080, 1.020, 0.000], [-1.080, -0.510, 0.883], [-1.080, -0.510, -0.883], [1.120, 0.900, 0.220], [1.120, -0.650, 0.660]]),
    "methanethiol": ([6, 16, 1, 1, 1, 1], [[-0.900, 0.000, 0.000], [0.900, 0.000, 0.000], [-1.270, 1.020, 0.000], [-1.270, -0.510, 0.883], [-1.270, -0.510, -0.883], [1.450, 0.980, 0.000]]),
    "fluoromethane": ([6, 9, 1, 1, 1], [[-0.350, 0.000, 0.000], [1.030, 0.000, 0.000], [-0.710, 1.020, 0.000], [-0.710, -0.510, 0.883], [-0.710, -0.510, -0.883]]),
    "chloromethane": ([6, 17, 1, 1, 1], [[-0.450, 0.000, 0.000], [1.330, 0.000, 0.000], [-0.810, 1.020, 0.000], [-0.810, -0.510, 0.883], [-0.810, -0.510, -0.883]]),
}


def write_goldens(model: torchani.arch.ANI, output: Path) -> None:
    model = model.float()
    records = []
    for name, (numbers, xyz) in GOLDEN_MOLECULES.items():
        species = torch.tensor([numbers], dtype=torch.long)
        coordinates = torch.tensor([xyz], dtype=torch.float32, requires_grad=True)
        evaluated = model((species, coordinates), ensemble_values=True)
        member_energies = evaluated.energies[:, 0]
        energy = member_energies.mean()
        forces = -torch.autograd.grad(energy, coordinates)[0][0]
        records.append({
            "name": name,
            "atomicNumbers": numbers,
            "positionsAngstrom": xyz,
            "energyHartree": float(energy.detach()),
            "memberEnergiesHartree": member_energies.detach().tolist(),
            "forcesHartreePerAngstrom": forces.detach().tolist(),
        })
    output.write_text(json.dumps({"schema": 1, "model": "ANI-2x", "records": records}, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "models")
    parser.add_argument("--state-dict", type=Path, default=Path.home() / ".local/share/Torchani/StateDicts/ani2x_state_dict.pt")
    args = parser.parse_args()

    torch.set_grad_enabled(True)
    model = torchani.models.ANI2x(periodic_table_index=True, device="cpu").eval()
    args.output.mkdir(parents=True, exist_ok=True)
    artifacts = {}
    for symbol in SYMBOLS:
        path = args.output / f"ani2x-{symbol.lower()}.onnx"
        export_element(model, symbol, path)
        artifacts[symbol] = {"file": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}

    goldens = args.output / "ani2x-goldens.json"
    write_goldens(model, goldens)
    manifest = {
        "schema": 1,
        "model": "ANI-2x",
        "torchaniVersion": torchani.__version__,
        "source": "https://huggingface.co/roitberg-group/ani2x",
        "stateDictSha256": sha256(args.state_dict),
        "symbols": list(SYMBOLS),
        "atomicNumbers": list(ATOMIC_NUMBERS),
        "ensembleSize": ENSEMBLE_SIZE,
        "aevLength": AEV_LENGTH,
        "radial": {"cutoff": 5.1, "eta": 19.7, "shifts": model.aev_computer.radial.shifts.tolist()},
        "angular": {"cutoff": 3.5, "eta": 12.5, "zeta": 14.1, "shifts": model.aev_computer.angular.shifts.tolist(), "sections": model.aev_computer.angular.sections.tolist()},
        "selfEnergiesHartree": model.energy_shifter.self_energies.tolist(),
        "artifacts": artifacts,
        "goldens": {"file": goldens.name, "sha256": sha256(goldens)},
        "units": {"positions": "angstrom", "energy": "hartree", "forces": "hartree/angstrom"},
        "domain": "Neutral, closed-shell molecules containing only H, C, N, O, F, S, and Cl.",
    }
    (args.output / "ani2x-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
