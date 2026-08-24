#!/usr/bin/env bash
set -euo pipefail

openmm_source_path=${1:?Usage: build-wasm.sh /path/to/openmm-8.2.0 /path/to/emscripten-prefix}
emscripten_prefix_path=${2:?Usage: build-wasm.sh /path/to/openmm-8.2.0 /path/to/emscripten-prefix}
script_path=$(cd "$(dirname "$0")" && pwd)
build_path="${openmm_source_path}/build-molarium-wasm"
output_path=${MOLARIUM_OPENMM_OUTPUT_DIR:-$script_path}
build_jobs=${MOLARIUM_BUILD_JOBS:-4}
mkdir -p "$output_path"

if ! grep -q '__EMSCRIPTEN__' "${openmm_source_path}/openmmapi/include/openmm/internal/hardware.h"; then
  patch -d "$openmm_source_path" -p1 < "${script_path}/openmm-8.2-emscripten.patch"
fi

if ! grep -q "browser build intentionally does not enable pthreads" \
    "${openmm_source_path}/platforms/reference/src/SimTKReference/ReferenceCCMAAlgorithm.cpp"; then
  patch -d "$openmm_source_path" -p1 < "${script_path}/openmm-8.2-emscripten-ccma.patch"
fi

"${emscripten_prefix_path}/bin/emcmake" cmake \
  -S "$openmm_source_path" \
  -B "$build_path" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS=-fwasm-exceptions \
  -DOPENMM_BUILD_SHARED_LIB=OFF \
  -DOPENMM_BUILD_STATIC_LIB=ON \
  -DOPENMM_BUILD_PYTHON_WRAPPERS=OFF \
  -DOPENMM_BUILD_C_AND_FORTRAN_WRAPPERS=OFF \
  -DOPENMM_BUILD_CPU_LIB=OFF \
  -DOPENMM_BUILD_CUDA_LIB=OFF \
  -DOPENMM_BUILD_OPENCL_LIB=OFF \
  -DOPENMM_BUILD_EXAMPLES=OFF \
  -DBUILD_TESTING=OFF

cmake --build "$build_path" --target OpenMM_static --parallel "$build_jobs"

"${emscripten_prefix_path}/bin/em++" \
  -O3 -std=c++17 -fwasm-exceptions \
  "${script_path}/molarium_openmm.cpp" \
  "${build_path}/libOpenMM_static.a" \
  -I"${openmm_source_path}/openmmapi/include" \
  -I"${openmm_source_path}/olla/include" \
  -I"${openmm_source_path}/serialization/include" \
  -I"${openmm_source_path}/libraries/lepton/include" \
  -I"${openmm_source_path}/platforms/reference/include" \
  --no-entry \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createMolariumOpenMM \
  -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sASSERTIONS=0 \
  '-sEXPORTED_FUNCTIONS=["_malloc","_free","_molarium_openmm_version","_molarium_forcefield_name","_molarium_last_error","_molarium_destroy","_molarium_initialize","_molarium_initialize_sage","_molarium_get_potential_energy","_molarium_minimize","_molarium_set_positions","_molarium_relax_fixed","_molarium_set_dynamics","_molarium_step","_molarium_get_positions","_molarium_get_forces"]' \
  '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAP32","HEAPF64"]' \
  -o "${output_path}/molarium-openmm.js"

echo "Built ${output_path}/molarium-openmm.js and molarium-openmm.wasm"
