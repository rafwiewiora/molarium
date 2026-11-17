"""Read-only Vulkan instance/device discovery, without molecular model or compute."""
import ctypes as c
import glob
import json
import os
from pathlib import Path
import struct
import sys


class Extension(c.Structure):
    _fields_ = [('name', c.c_char * 256), ('version', c.c_uint32)]


class Application(c.Structure):
    _fields_ = [('sType', c.c_uint32), ('pNext', c.c_void_p), ('name', c.c_char_p),
                ('version', c.c_uint32), ('engine', c.c_char_p),
                ('engineVersion', c.c_uint32), ('apiVersion', c.c_uint32)]


class CreateInfo(c.Structure):
    _fields_ = [('sType', c.c_uint32), ('pNext', c.c_void_p), ('flags', c.c_uint32),
                ('application', c.POINTER(Application)), ('layerCount', c.c_uint32),
                ('layers', c.c_void_p), ('extensionCount', c.c_uint32), ('extensions', c.c_void_p)]


r = {'scope': __doc__, 'icd': os.environ.get('VK_ICD_FILENAMES'),
     'libraryPath': os.environ.get('LD_LIBRARY_PATH'), 'python': sys.version,
     'deviceNodes': [{'path': p, 'readable': os.access(p, os.R_OK), 'writable': os.access(p, os.W_OK)}
                     for p in sorted(glob.glob('/dev/nvidia*') + glob.glob('/dev/dri/*'))]}
instance = c.c_void_p()
try:
    vk = c.CDLL('libvulkan.so.1')
    enumerate_extensions = vk.vkEnumerateInstanceExtensionProperties
    enumerate_extensions.argtypes = [c.c_char_p, c.POINTER(c.c_uint32), c.POINTER(Extension)]
    enumerate_extensions.restype = c.c_int32
    count = c.c_uint32()
    r['extensionCountCode'] = enumerate_extensions(None, c.byref(count), None)
    extensions = (Extension * count.value)()
    r['extensionListCode'] = enumerate_extensions(None, c.byref(count), extensions)
    r['extensions'] = [bytes(e.name).decode() for e in extensions]
    app = Application(0, None, b'Molarium capability-only probe', 1, b'none', 1, (1 << 22))
    info = CreateInfo(1, None, 0, c.pointer(app), 0, None, 0, None)
    vk.vkCreateInstance.argtypes = [c.POINTER(CreateInfo), c.c_void_p, c.POINTER(c.c_void_p)]
    vk.vkCreateInstance.restype = c.c_int32
    r['createInstanceCode'] = vk.vkCreateInstance(c.byref(info), None, c.byref(instance))
    if r['createInstanceCode'] == 0:
        enumerate_devices = vk.vkEnumeratePhysicalDevices
        enumerate_devices.argtypes = [c.c_void_p, c.POINTER(c.c_uint32), c.POINTER(c.c_void_p)]
        enumerate_devices.restype = c.c_int32
        count = c.c_uint32()
        r['deviceCountCode'] = enumerate_devices(instance, c.byref(count), None)
        r['physicalDeviceCount'] = count.value
        devices = (c.c_void_p * count.value)()
        r['deviceListCode'] = enumerate_devices(instance, c.byref(count), devices)
        vk.vkGetPhysicalDeviceProperties.argtypes = [c.c_void_p, c.c_void_p]
        r['devices'] = []
        for device in devices:
            # VkPhysicalDeviceProperties has a stable initial five uint32s and char[256].
            # Oversized writable storage retains all trailing implementation properties.
            buf = c.create_string_buffer(4096)
            vk.vkGetPhysicalDeviceProperties(device, buf)
            api, driver, vendor, device_id, kind = struct.unpack('=5I', buf.raw[:20])
            r['devices'].append({'apiVersion': api, 'driverVersion': driver,
                                 'vendorId': hex(vendor), 'deviceId': hex(device_id),
                                 'deviceType': kind, 'name': buf.raw[20:276].split(b'\0')[0].decode()})
except Exception as exc:
    r['error'] = type(exc).__name__ + ': ' + str(exc)
finally:
    if instance.value:
        vk.vkDestroyInstance.argtypes = [c.c_void_p, c.c_void_p]
        vk.vkDestroyInstance(instance, None)
Path(sys.argv[1]).write_text(json.dumps(r, indent=2) + '\n')
print(json.dumps(r))
