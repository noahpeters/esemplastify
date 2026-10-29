#!/usr/bin/env node
// Read the operator credential in memory from macOS Keychain. Never put it in argv or logs.
import { spawnSync } from 'node:child_process';
const base = 'https://esemplastify.gr4gwzrfq2.workers.dev';
const keychainReader = `
import ctypes,sys
s=ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
f=s.SecKeychainFindGenericPassword
f.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.POINTER(ctypes.c_uint32),ctypes.POINTER(ctypes.c_void_p),ctypes.c_void_p]
f.restype=ctypes.c_int32
service=b'esemplastify.editorial';account=b'production';length=ctypes.c_uint32();data=ctypes.c_void_p()
status=f(None,len(service),service,len(account),account,ctypes.byref(length),ctypes.byref(data),None)
if status:sys.exit('Keychain access failed, OSStatus '+str(status))
sys.stdout.buffer.write(ctypes.string_at(data,length.value))
s.SecKeychainItemFreeContent(None,data)
`;
const [path, method = 'GET', body] = process.argv.slice(2);
if (!path || (!path.startsWith('/api/') && path !== '/health') || !['GET','POST'].includes(method)) {
  console.error('Usage: node scripts/editorial-request.mjs /api/path [GET|POST] [JSON body]');
  process.exit(2);
}
const credential = spawnSync('python3', ['-c', keychainReader], { encoding: 'utf8' });
if (credential.status !== 0 || !credential.stdout) {
  console.error('Unable to read the Esemplastify editorial credential from macOS Keychain.');
  process.exit(1);
}
const token = credential.stdout.trim();
try {
  const response = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? {'content-type':'application/json'} : {}) },
    body, signal: AbortSignal.timeout(60000), redirect: 'error',
  });
  const result = await response.text();
  // Redaction also covers unexpected server responses; the token never enters output.
  console.log(result.replaceAll(token, '[REDACTED]'));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Editorial request failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
  process.exitCode = 1;
}
