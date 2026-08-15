#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef REAL_EXEC
#define REAL_EXEC "Codex++-bin"
#endif

#ifndef USER_DATA_DIR
#define USER_DATA_DIR ""
#endif

int main(int argc, char *argv[]) {
  char self[PATH_MAX];
  uint32_t size = sizeof(self);
  if (_NSGetExecutablePath(self, &size) != 0) return 1;

  char *slash = strrchr(self, '/');
  if (slash == NULL) return 1;
  *slash = '\0';

  char target[PATH_MAX];
  if (snprintf(target, sizeof(target), "%s/%s", self, REAL_EXEC) >= (int)sizeof(target)) return 1;

  const char *data_dir = USER_DATA_DIR;
  int extra = (data_dir[0] != '\0') ? 1 : 0;

  char **args = calloc((size_t)argc + (size_t)extra + 1, sizeof(char *));
  if (args == NULL) return 1;

  int n = 0;
  args[n++] = target;

  char switch_arg[PATH_MAX + 32];
  if (extra) {
    snprintf(switch_arg, sizeof(switch_arg), "--user-data-dir=%s", data_dir);
    args[n++] = switch_arg;
  }
  for (int i = 1; i < argc; i++) args[n++] = argv[i];
  args[n] = NULL;

  execv(target, args);
  perror("codexpp-launcher");
  return 127;
}
