# Molarium OpenFold browser model card

## Source and attribution

- Project: OpenFold by the AlQuraishi Laboratory and contributors
- OpenFold source revision used: `be2ec1841f16c966c65ae0e7599ebbadc725757d`
- Model config: `model_3_ptm` with templates disabled for this export
- Checkpoint: `finetuning_no_templ_ptm_1.pt`
- Source URL: `https://openfold.s3.amazonaws.com/params/finetuning_no_templ_ptm_1.pt`
- Download size: 373,259,620 bytes
- Checkpoint SHA-256: `1a179937a6f61143c41f8b6a0b763ac1f4762c9dc63d2fb151240930c110bee1`

OpenFold source code is Apache-2.0. OpenFold's pretrained parameters are published under CC BY 4.0; the trained ONNX artifacts in this directory retain that attribution/license requirement. See the official OpenFold parameter documentation before redistribution.

## Transformation

The PyTorch checkpoint was imported with OpenFold's `import_openfold_weights_` and exported to fixed-shape ONNX at opset 18 in 64- and 128-residue buckets. Model arithmetic and parameter values were not retrained or fine-tuned. The export exposes inference confidence heads and externalizes the recycle loop to the JavaScript host.

## Intended use

Interactive, browser-local exploration of template-free monomer predictions up to 128 residues. Outputs are atom37 coordinates, atom mask, pLDDT, pTM and PAE. This is not validated for clinical, diagnostic or safety-critical use.

Runtime artifact sizes and SHA-256 hashes are recorded in
[`../../r2-assets-manifest.json`](../../r2-assets-manifest.json). Current scientific limitations
and validation status are summarized in the main project README.
