#!/usr/bin/env python3
"""Build the paper's reproducible benchmark chart and optional UI montage."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from matplotlib.ticker import MultipleLocator
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
FIGURES = ROOT / "figures"
INK = "#172532"
TEAL = "#1f7481"
BLUE = "#4263d8"
GREEN = "#58a779"
PURPLE = "#9b59c5"
GRID = "#dbe3e8"


def label_font(size: int):
    candidates = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def framed_panel(image: Image.Image, size: tuple[int, int], label: str) -> Image.Image:
    source = image.convert("RGB")
    contained = ImageOps.contain(source, size, method=Image.Resampling.LANCZOS)
    panel = Image.new("RGB", size, "white")
    panel.paste(contained, ((size[0] - contained.width) // 2,
                            (size[1] - contained.height) // 2))
    shade = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shade)
    draw.rounded_rectangle((18, 18, 205, 82), radius=18, fill=(19, 38, 49, 235))
    draw.text((43, 31), label, font=label_font(32), fill="white")
    return Image.alpha_composite(panel.convert("RGBA"), shade).convert("RGB")


def make_interface_montage(view_path: Path, build_path: Path, run_path: Path) -> None:
    view = Image.open(view_path)
    build = Image.open(build_path)
    run = Image.open(run_path)

    # A horizontal triptych preserves each complete application viewport. The
    # previous montage enlarged partial crops, which made the side panels look
    # accidentally cut off in print.
    canvas = Image.new("RGB", (2400, 455), "white")
    canvas.paste(framed_panel(view, (780, 445), "A  View"), (0, 0))
    canvas.paste(framed_panel(build, (780, 445), "B  Build"), (810, 0))
    canvas.paste(framed_panel(run, (780, 445), "C  Inspect"), (1620, 0))
    canvas.save(FIGURES / "interface-workflow.png", optimize=True)


def make_performance_figure() -> None:
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.labelcolor": INK,
        "axes.edgecolor": GRID,
        "xtick.color": "#526274",
        "ytick.color": INK,
        "text.color": INK,
    })

    simulation_labels = [
        "Trp-cage\nDirect Sage",
        "Ubiquitin vacuum\nDirect Sage",
        "Ubiquitin OBC2\nDirect Sage",
        "1,024 C16 replicas\nReplica engine",
        "256 water27 replicas\nReplica engine",
    ]
    simulation_values = [2.09, 9.16, 25.6, 10.3, 24.1]
    browser_labels = ["ANI-2x GPU\nbuffer path", "RDKit\nworker pool"]
    browser_values = [6.77, 1.77]

    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.05),
                             gridspec_kw={"width_ratios": [1.75, 1]})
    fig.patch.set_facecolor("white")

    ax = axes[0]
    positions = list(range(len(simulation_labels)))
    colors = [BLUE, BLUE, BLUE, GREEN, GREEN]
    bars = ax.barh(positions, simulation_values, color=colors, height=0.63)
    ax.set_yticks(positions, simulation_labels)
    ax.invert_yaxis()
    ax.set_xlim(0, 29)
    ax.xaxis.set_major_locator(MultipleLocator(5))
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xlabel("speedup over OpenMM Reference WASM")
    ax.set_title("Molecular simulation", loc="left", weight="bold", fontsize=11)
    for bar, value in zip(bars, simulation_values):
        ax.text(value + 0.45, bar.get_y() + bar.get_height() / 2,
                f"{value:g}x", va="center", weight="bold", fontsize=8.5)

    ax = axes[1]
    positions = list(range(len(browser_labels)))
    bars = ax.barh(positions, browser_values, color=[PURPLE, TEAL], height=0.55)
    ax.set_yticks(positions, browser_labels)
    ax.invert_yaxis()
    ax.set_xlim(0, 8)
    ax.xaxis.set_major_locator(MultipleLocator(2))
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xlabel("speedup over prior browser path")
    ax.set_title("Pipeline changes", loc="left", weight="bold", fontsize=11)
    for bar, value in zip(bars, browser_values):
        ax.text(value + 0.17, bar.get_y() + bar.get_height() / 2,
                f"{value:g}x", va="center", weight="bold", fontsize=8.5)

    for ax in axes:
        ax.spines[["top", "right", "left"]].set_visible(False)
        ax.tick_params(axis="y", length=0)
    fig.subplots_adjust(left=0.19, right=0.98, top=0.84, bottom=0.22, wspace=0.62)
    fig.savefig(FIGURES / "performance.pdf", bbox_inches="tight")
    fig.savefig(FIGURES / "performance.png", dpi=220, bbox_inches="tight")
    plt.close(fig)


def make_development_loop() -> None:
    """Draw the human-agent-test-repository loop as a paper-scale schematic."""
    plt.rcParams.update({"font.family": "DejaVu Sans"})
    fig, ax = plt.subplots(figsize=(7.2, 1.72))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    stages = [
        ("CHEMIST NOTICES", "wrong shape\nwrong energy\nstalled run", "#eaf5f0", GREEN),
        ("AGENT IMPLEMENTS", "topology + WGSL\nprotocol + interface", "#eef2ff", BLUE),
        ("INDEPENDENT CHECK", "OpenMM · TorchANI\nfinite differences", "#f4edfa", PURPLE),
        ("REPOSITORY KEEPS", "method + tests\nbenchmark + provenance", "#eaf5f0", GREEN),
    ]
    xs = [0.02, 0.272, 0.524, 0.776]
    width = 0.202
    for idx, ((title, body, face, edge), x) in enumerate(zip(stages, xs)):
        box = FancyBboxPatch(
            (x, 0.18), width, 0.62,
            boxstyle="round,pad=0.012,rounding_size=0.025",
            linewidth=1.5, edgecolor=edge, facecolor=face,
        )
        ax.add_patch(box)
        ax.text(x + width / 2, 0.66, title, ha="center", va="center",
                color=edge, fontsize=8.5, fontweight="bold")
        ax.text(x + width / 2, 0.42, body, ha="center", va="center",
                color=INK, fontsize=8.5, linespacing=1.35)
        if idx < len(stages) - 1:
            ax.annotate(
                "", xy=(xs[idx + 1] - 0.008, 0.49),
                xytext=(x + width + 0.008, 0.49),
                arrowprops={"arrowstyle": "-|>", "color": "#7b8b97", "lw": 1.4},
            )
    ax.text(0.5, 0.94, "A scientific build loop", ha="center", va="center",
            color=INK, fontsize=11, fontweight="bold")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(FIGURES / "development-loop.pdf", bbox_inches="tight", pad_inches=0.02)
    fig.savefig(FIGURES / "development-loop.png", dpi=240,
                bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)


def make_execution_map() -> None:
    """Show the numeric-System boundary and the three browser workloads."""
    plt.rcParams.update({"font.family": "DejaVu Sans"})
    fig, ax = plt.subplots(figsize=(7.2, 2.15))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    def box(x, y, w, h, title, body, face, edge):
        patch = FancyBboxPatch(
            (x, y), w, h,
            boxstyle="round,pad=0.012,rounding_size=0.022",
            linewidth=1.4, edgecolor=edge, facecolor=face,
        )
        ax.add_patch(patch)
        ax.text(x + w / 2, y + h * 0.69, title, ha="center", va="center",
                color=edge, fontsize=8.2, fontweight="bold")
        ax.text(x + w / 2, y + h * 0.35, body, ha="center", va="center",
                color=INK, fontsize=7.9, linespacing=1.25)

    box(0.015, 0.30, 0.17, 0.45, "PREPARE", "RDKit graph + 3D\nOpenFF parameters",
        "#f7f9fb", TEAL)
    box(0.235, 0.25, 0.205, 0.55, "NUMERIC SYSTEM",
        "masses · charges · terms\nexceptions · constraints\noptional GB parameters",
        "#eaf5f0", GREEN)
    workloads = [
        (0.68, "DIRECT WEBGPU", "one System\none trajectory", BLUE, "#eef2ff"),
        (0.40, "REPLICA WEBGPU", "one topology\nmany conformers", GREEN, "#eaf5f0"),
        (0.12, "ANI-2x + ONNX", "one model\nmany conformers", PURPLE, "#f4edfa"),
    ]
    for y, title, body, edge, face in workloads:
        box(0.51, y, 0.205, 0.19, title, body, face, edge)
        ax.annotate("", xy=(0.50, y + 0.095), xytext=(0.448, 0.525),
                    arrowprops={"arrowstyle": "-|>", "color": "#7b8b97", "lw": 1.25})

    box(0.79, 0.25, 0.19, 0.55, "CHECK",
        "OpenMM Reference\nTorchANI\nfinite differences\nfixed fixtures",
        "#f7f9fb", TEAL)
    for y, *_ in workloads:
        ax.annotate("", xy=(0.78, 0.525), xytext=(0.723, y + 0.095),
                    arrowprops={"arrowstyle": "-|>", "color": "#7b8b97", "lw": 1.1})
    ax.annotate("", xy=(0.225, 0.525), xytext=(0.193, 0.525),
                arrowprops={"arrowstyle": "-|>", "color": "#7b8b97", "lw": 1.4})
    ax.text(0.5, 0.94, "One chemical boundary, three browser workloads",
            ha="center", va="center", color=INK, fontsize=11, fontweight="bold")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(FIGURES / "execution-map.pdf", bbox_inches="tight", pad_inches=0.02)
    fig.savefig(FIGURES / "execution-map.png", dpi=240,
                bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--view", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--run", type=Path)
    args = parser.parse_args()
    FIGURES.mkdir(parents=True, exist_ok=True)
    make_performance_figure()
    make_development_loop()
    make_execution_map()
    if any((args.view, args.build, args.run)):
        if not all((args.view, args.build, args.run)):
            parser.error("--view, --build, and --run must be supplied together")
        make_interface_montage(args.view, args.build, args.run)


if __name__ == "__main__":
    main()
