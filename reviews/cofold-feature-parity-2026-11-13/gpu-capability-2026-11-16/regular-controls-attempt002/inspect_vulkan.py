"""Read loader entry points only; no molecular model is imported or executed."""
import ctypes
import json
import os
from pathlib import Path
import sys

icd = json.loads(Path(sys.argv[1]).read_bytes())
record = {'libraryPath': icd['ICD']['library_path'], 'LD_LIBRARY_PATH': os.environ.get('LD_LIBRARY_PATH'),
          'VK_ICD_FILENAMES': os.environ.get('VK_ICD_FILENAMES')}
try:
    library = ctypes.CDLL(record['libraryPath'])
    function = library.vk_icdGetInstanceProcAddr
    function.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    function.restype = ctypes.c_void_p
    record['vkCreateInstanceEntryPointAvailable'] = bool(function(None, b'vkCreateInstance'))
except Exception as exc:
    record['icdError'] = type(exc).__name__ + ': ' + str(exc)
try:
    loader = ctypes.CDLL('libvulkan.so.1')
    count = ctypes.c_uint32()
    function = loader.vkEnumerateInstanceExtensionProperties
    function.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p]
    function.restype = ctypes.c_int32
    record['enumerateInstanceExtensionsCode'] = int(function(None, ctypes.byref(count), None))
    record['instanceExtensionCount'] = count.value
except Exception as exc:
    record['loaderError'] = type(exc).__name__ + ': ' + str(exc)
Path('driver-entrypoints.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
