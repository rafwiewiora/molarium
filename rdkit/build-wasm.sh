#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/rdkit-Release_2025_03_4" >&2
  exit 2
fi

source_dir=$(cd "$1" && pwd)
project_dir=$(cd "$(dirname "$0")/.." && pwd)
build_dir="${TMPDIR:-/tmp}/molarium-rdkit-wasm-build-v2"
python_dir=/opt/homebrew/opt/python@3.14/bin
emscripten_dir=/opt/homebrew/Cellar/emscripten/6.0.6/libexec
export PATH="$python_dir:/opt/homebrew/bin:/usr/bin:/bin"
export EM_CACHE=${EM_CACHE:-${TMPDIR:-/tmp}/molarium-emscripten-cache}
mkdir -p "$EM_CACHE"

cp "$project_dir/rdkit/forcefield.cpp" "$source_dir/Code/MinimalLib/molarium_forcefield.cpp"
if git -C "$source_dir" apply --check "$project_dir/rdkit/minimal-forcefield.patch" 2>/dev/null; then
  git -C "$source_dir" apply "$project_dir/rdkit/minimal-forcefield.patch"
elif ! git -C "$source_dir" apply --reverse --check "$project_dir/rdkit/minimal-forcefield.patch" 2>/dev/null; then
  echo "RDKit source does not match the expected release or patch state" >&2
  exit 1
fi

"$emscripten_dir/emcmake" cmake -S "$source_dir" -B "$build_dir" \
  -DRDK_BUILD_MINIMAL_LIB=ON \
  -DRDK_BUILD_PYTHON_WRAPPERS=OFF \
  -DRDK_BUILD_CPP_TESTS=OFF \
  -DRDK_BUILD_INCHI_SUPPORT=OFF \
  -DRDK_USE_BOOST_SERIALIZATION=OFF \
  -DRDK_OPTIMIZE_POPCNT=OFF \
  -DRDK_BUILD_THREADSAFE_SSS=OFF \
  -DRDK_BUILD_DESCRIPTORS3D=OFF \
  -DRDK_TEST_MULTITHREADED=OFF \
  -DRDK_BUILD_MAEPARSER_SUPPORT=OFF \
  -DRDK_BUILD_COORDGEN_SUPPORT=OFF \
  -DRDK_BUILD_FREETYPE_SUPPORT=OFF \
  -DRDK_BUILD_MINIMAL_LIB_RXN=OFF \
  -DRDK_BUILD_MINIMAL_LIB_SUBSTRUCTLIBRARY=OFF \
  -DRDK_BUILD_SLN_SUPPORT=OFF \
  -DRDK_USE_BOOST_IOSTREAMS=OFF \
  -DBoost_DIR=/opt/homebrew/Cellar/boost/1.92.0/lib/cmake/Boost-1.92.0 \
  -Dboost_headers_DIR=/opt/homebrew/Cellar/boost/1.92.0/lib/cmake/boost_headers-1.92.0 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-fexceptions -sNO_DISABLE_EXCEPTION_CATCHING -O3 -DNDEBUG" \
  -DCMAKE_C_FLAGS="-fexceptions -sNO_DISABLE_EXCEPTION_CATCHING -O3 -DNDEBUG" \
  -DCMAKE_EXE_LINKER_FLAGS="-fexceptions -sNO_DISABLE_EXCEPTION_CATCHING -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME='initRDKitModule'"

cmake --build "$build_dir" --target RDKit_minimal -j6
mkdir -p "$project_dir/rdkit/dist"
cp "$build_dir/Code/MinimalLib/RDKit_minimal.js" "$project_dir/rdkit/dist/"
cp "$build_dir/Code/MinimalLib/RDKit_minimal.wasm" "$project_dir/rdkit/dist/"
