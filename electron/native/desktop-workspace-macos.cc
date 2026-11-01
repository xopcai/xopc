#include <node_api.h>
#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <fcntl.h>
#include <limits.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <stdexcept>
#include <string>
#include <vector>

// N-API methods run synchronously in a dedicated Node worker, never the Electron UI thread.
namespace {
constexpr size_t limit = 32768;
struct Failure : std::runtime_error { using std::runtime_error::runtime_error; };
struct Fd {
  int fd;
  explicit Fd(int value) : fd(value) { if (fd < 0) throw Failure("WORKSPACE_PATH_DENIED"); }
  ~Fd() { if (fd >= 0) close(fd); }
  Fd(const Fd&) = delete;
};
struct Root { int fd; };
void check(napi_status status) { if (status != napi_ok) throw Failure("WORKSPACE_ARGUMENT_INVALID"); }
std::string string(napi_env env, napi_value input) {
  size_t length; check(napi_get_value_string_utf8(env, input, nullptr, 0, &length));
  if (length > limit) throw Failure("WORKSPACE_ARGUMENT_INVALID");
  std::vector<char> data(length + 1); check(napi_get_value_string_utf8(env, input, data.data(), data.size(), &length));
  return std::string(data.data(), length);
}
napi_value text(napi_env env, const std::string& input) { napi_value value; check(napi_create_string_utf8(env, input.data(), input.size(), &value)); return value; }
std::vector<std::string> parts(const std::string& input, bool allowRoot) {
  if (input.empty() && allowRoot) return {};
  if (input.empty() || input.size() > 4096 || input.front() == '/' || input.find('\\') != std::string::npos || input.find('\0') != std::string::npos) throw Failure("WORKSPACE_PATH_INVALID");
  std::vector<std::string> result; size_t start = 0;
  while (start <= input.size()) {
    auto end = input.find('/', start); if (end == std::string::npos) end = input.size();
    auto name = input.substr(start, end - start);
    if (name.empty() || name == "." || name == ".." || name.size() > 255 || result.size() >= 64) throw Failure("WORKSPACE_PATH_INVALID");
    result.push_back(name); if (end == input.size()) break; start = end + 1;
  }
  return result;
}
int directory(int root, const std::vector<std::string>& names, size_t count) {
  Fd current(dup(root));
  for (size_t i = 0; i < count; ++i) {
    Fd next(openat(current.fd, names[i].c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
    close(current.fd); current.fd = next.fd; next.fd = -1;
  }
  int result = current.fd; current.fd = -1; return result;
}
struct stat regular(int fd) {
  struct stat value;
  if (fstat(fd, &value) || !S_ISREG(value.st_mode) || value.st_nlink != 1) throw Failure("WORKSPACE_FILE_DENIED");
  if (value.st_size > static_cast<off_t>(limit)) throw Failure("WORKSPACE_FILE_TOO_LARGE");
  return value;
}
std::string readText(int fd) {
  regular(fd); std::string value; char buffer[4096];
  for (;;) {
    auto count = read(fd, buffer, sizeof(buffer));
    if (count < 0) { if (errno == EINTR) continue; throw Failure("WORKSPACE_IO_ERROR"); }
    if (!count) return value;
    value.append(buffer, count); if (value.size() > limit) throw Failure("WORKSPACE_FILE_TOO_LARGE");
  }
}
std::string digest(const std::string& value) {
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(value.data(), static_cast<CC_LONG>(value.size()), bytes);
  const char* hex = "0123456789abcdef"; std::string result;
  for (auto byte : bytes) { result += hex[byte >> 4]; result += hex[byte & 15]; } return result;
}
std::vector<napi_value> args(napi_env env, napi_callback_info info, size_t count) {
  std::vector<napi_value> result(count); size_t actual = count; check(napi_get_cb_info(env, info, &actual, result.data(), nullptr, nullptr));
  if (actual != count) throw Failure("WORKSPACE_ARGUMENT_INVALID"); return result;
}
Root* root(napi_env env, napi_value input) { Root* value; check(napi_get_value_external(env, input, reinterpret_cast<void**>(&value))); if (!value || value->fd < 0) throw Failure("WORKSPACE_ROOT_CLOSED"); return value; }
template<typename Work> napi_value guarded(napi_env env, Work work) {
  try { return work(); } catch (const Failure& error) { napi_throw_error(env, error.what(), error.what()); }
  catch (...) { napi_throw_error(env, "WORKSPACE_IO_ERROR", "WORKSPACE_IO_ERROR"); } return nullptr;
}
napi_value openRoot(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 1); auto path = string(env, input[0]);
  if (path.empty() || path.front() != '/' || path.find('\0') != std::string::npos) throw Failure("WORKSPACE_PATH_INVALID");
  Fd fd(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  auto value = new Root{fd.fd}; fd.fd = -1; napi_value result;
  auto status = napi_create_external(env, value, [](napi_env, void* data, void*) { auto value = static_cast<Root*>(data); if (value->fd >= 0) close(value->fd); delete value; }, nullptr, &result);
  if (status != napi_ok) { close(value->fd); delete value; check(status); } return result;
}); }
napi_value closeRoot(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 1); auto value = root(env, input[0]); close(value->fd); value->fd = -1;
  napi_value result; check(napi_get_undefined(env, &result)); return result;
}); }
napi_value rootInfo(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 1); auto value = root(env, input[0]); struct stat identity; char path[PATH_MAX];
  if (fstat(value->fd, &identity) || fcntl(value->fd, F_GETPATH, path) < 0) throw Failure("WORKSPACE_PATH_DENIED");
  napi_value result; check(napi_create_object(env, &result));
  check(napi_set_named_property(env, result, "path", text(env, path)));
  check(napi_set_named_property(env, result, "device", text(env, std::to_string(identity.st_dev))));
  check(napi_set_named_property(env, result, "inode", text(env, std::to_string(identity.st_ino)))); return result;
}); }
napi_value readFile(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 2); auto names = parts(string(env, input[1]), false);
  Fd parent(directory(root(env, input[0])->fd, names, names.size() - 1));
  Fd fd(openat(parent.fd, names.back().c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
  auto bytes = readText(fd.fd); napi_value result; check(napi_create_buffer_copy(env, bytes.size(), bytes.data(), nullptr, &result)); return result;
}); }
napi_value writeFile(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 4); auto names = parts(string(env, input[1]), false); auto bytes = string(env, input[2]);
  napi_valuetype type; check(napi_typeof(env, input[3], &type)); const bool create = type == napi_null;
  auto expected = create ? std::string() : string(env, input[3]);
  if (!create && (expected.size() != 64 || expected.find_first_not_of("0123456789abcdef") != std::string::npos)) throw Failure("WORKSPACE_ARGUMENT_INVALID");
  Fd parent(directory(root(env, input[0])->fd, names, names.size() - 1)); bool changed = false;
  const int raw = openat(parent.fd, names.back().c_str(), O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | (create ? O_CREAT | O_EXCL : 0), 0600);
  if (raw < 0) throw Failure(create && errno == EEXIST ? "WORKSPACE_VERSION_CONFLICT" : "WORKSPACE_FILE_DENIED");
  Fd fd(raw); if (create) changed = true;
  try {
    if (flock(fd.fd, LOCK_EX | LOCK_NB)) throw Failure("WORKSPACE_FILE_BUSY");
    const auto identity = regular(fd.fd);
    if (!create && digest(readText(fd.fd)) != expected) throw Failure("WORKSPACE_VERSION_CONFLICT");
    struct stat linked;
    if (fstatat(parent.fd, names.back().c_str(), &linked, AT_SYMLINK_NOFOLLOW) || linked.st_dev != identity.st_dev || linked.st_ino != identity.st_ino || linked.st_nlink != 1) throw Failure("WORKSPACE_VERSION_CONFLICT");
    if (lseek(fd.fd, 0, SEEK_SET) < 0) throw Failure("WORKSPACE_IO_ERROR");
    changed = true; size_t offset = 0;
    while (offset < bytes.size()) { auto count = write(fd.fd, bytes.data() + offset, bytes.size() - offset);
      if (count < 0) { if (errno == EINTR) continue; throw Failure("WORKSPACE_IO_ERROR"); }
      if (!count) throw Failure("WORKSPACE_IO_ERROR"); offset += count;
    }
    if (ftruncate(fd.fd, bytes.size()) || fsync(fd.fd) || fsync(parent.fd)) throw Failure("WORKSPACE_IO_ERROR");
    return text(env, digest(bytes));
  } catch (...) { if (changed) throw Failure("WORKSPACE_OUTCOME_UNKNOWN"); throw; }
}); }
napi_value list(napi_env env, napi_callback_info info) { return guarded(env, [&] {
  const auto input = args(env, info, 2); auto names = parts(string(env, input[1]), true);
  Fd fd(directory(root(env, input[0])->fd, names, names.size())); DIR* stream = fdopendir(fd.fd);
  if (!stream) throw Failure("WORKSPACE_PATH_DENIED"); fd.fd = -1;
  struct Stream { DIR* value; ~Stream() { closedir(value); } } guard{stream};
  napi_value entries; check(napi_create_array(env, &entries)); size_t count = 0, scanned = 0; bool truncated = false;
  while (auto entry = readdir(stream)) {
    std::string name(entry->d_name); if (name == "." || name == "..") continue;
    if (++scanned > 1000 || count == 100) { truncated = true; break; }
    struct stat value; if (fstatat(dirfd(stream), name.c_str(), &value, AT_SYMLINK_NOFOLLOW)) continue;
    if (!S_ISDIR(value.st_mode) && !(S_ISREG(value.st_mode) && value.st_nlink == 1)) continue;
    napi_value item; check(napi_create_object(env, &item)); check(napi_set_named_property(env, item, "name", text(env, name)));
    check(napi_set_named_property(env, item, "kind", text(env, S_ISDIR(value.st_mode) ? "directory" : "file")));
    check(napi_set_element(env, entries, count++, item));
  }
  napi_value result, flag; check(napi_create_object(env, &result)); check(napi_get_boolean(env, truncated, &flag));
  check(napi_set_named_property(env, result, "entries", entries)); check(napi_set_named_property(env, result, "truncated", flag)); return result;
}); }
}
NAPI_MODULE_INIT() {
  napi_property_descriptor descriptors[] = {
    {"openRoot", nullptr, openRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeRoot", nullptr, closeRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"rootInfo", nullptr, rootInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readFile", nullptr, readFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"writeFile", nullptr, writeFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"list", nullptr, list, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(descriptors)/sizeof(descriptors[0]), descriptors) != napi_ok) return nullptr;
  return exports;
}
