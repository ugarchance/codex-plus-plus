// codexpp-keychain: keeps the Codex++ provider-secrets master key in the login
// keychain. The Codex Electron build omits electron_browser_safe_storage on
// macOS as well as on Windows, so hub/provider-secrets.cjs derives the same
// guarantee from this helper: the secret travels through stdin/stdout only,
// never through argv, the environment or temp files.
//
//   codexpp-keychain get [--service NAME]      write the stored value to stdout
//   codexpp-keychain set [--service NAME]      read stdin, add the item (never overwrites)
//   codexpp-keychain delete [--service NAME]   remove the item (tests only)
//
// Exit codes: 0 ok, 44 not found, 45 already exists, 2 bad input, 1 keychain error.
//
// Build: clang -O2 -framework Security -framework CoreFoundation -o codexpp-keychain keychain.c

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DEFAULT_SERVICE "CodexPP Safe Storage"
#define ACCOUNT "CodexPP provider secrets"
#define MAX_SECRET 4096

static CFMutableDictionaryRef query(const char *service) {
  CFMutableDictionaryRef q = CFDictionaryCreateMutable(
      NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFStringRef svc = CFStringCreateWithCString(NULL, service, kCFStringEncodingUTF8);
  CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(q, kSecAttrService, svc);
  CFDictionarySetValue(q, kSecAttrAccount, CFSTR(ACCOUNT));
  CFRelease(svc);
  return q;
}

static int fail(const char *what, OSStatus status) {
  fprintf(stderr, "%s: OSStatus %d\n", what, (int)status);
  return 1;
}

static int get(const char *service) {
  CFMutableDictionaryRef q = query(service);
  CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(q, &result);
  CFRelease(q);
  if (status == errSecItemNotFound) return 44;
  if (status != errSecSuccess) return fail("SecItemCopyMatching", status);
  CFDataRef data = (CFDataRef)result;
  fwrite(CFDataGetBytePtr(data), 1, (size_t)CFDataGetLength(data), stdout);
  fflush(stdout);
  CFRelease(result);
  return 0;
}

static int set(const char *service) {
  unsigned char buffer[MAX_SECRET];
  size_t length = fread(buffer, 1, sizeof buffer, stdin);
  if (length == 0 || length == sizeof buffer) {
    fprintf(stderr, "secret must be 1..%d bytes\n", MAX_SECRET - 1);
    return 2;
  }
  CFDataRef data = CFDataCreate(NULL, buffer, (CFIndex)length);
  memset(buffer, 0, sizeof buffer);
  CFMutableDictionaryRef q = query(service);
  CFDictionarySetValue(q, kSecValueData, data);
  CFDictionarySetValue(q, kSecAttrLabel, CFSTR("Codex++ provider secrets master key"));
  OSStatus status = SecItemAdd(q, NULL);
  CFRelease(q);
  CFRelease(data);
  if (status == errSecDuplicateItem) return 45;
  if (status != errSecSuccess) return fail("SecItemAdd", status);
  return 0;
}

static int delete_item(const char *service) {
  CFMutableDictionaryRef q = query(service);
  OSStatus status = SecItemDelete(q);
  CFRelease(q);
  if (status == errSecItemNotFound) return 44;
  if (status != errSecSuccess) return fail("SecItemDelete", status);
  return 0;
}

int main(int argc, char **argv) {
  const char *command = argc > 1 ? argv[1] : "";
  const char *service = DEFAULT_SERVICE;
  for (int i = 2; i < argc; i++) {
    if (strcmp(argv[i], "--service") == 0 && i + 1 < argc) service = argv[++i];
    else { fprintf(stderr, "unknown argument: %s\n", argv[i]); return 2; }
  }
  if (strcmp(command, "get") == 0) return get(service);
  if (strcmp(command, "set") == 0) return set(service);
  if (strcmp(command, "delete") == 0) return delete_item(service);
  fprintf(stderr, "usage: codexpp-keychain get|set|delete [--service NAME]\n");
  return 2;
}
