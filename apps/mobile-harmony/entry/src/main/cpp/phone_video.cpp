#include <napi/native_api.h>
#include <native_window/external_window.h>
#include <multimedia/player_framework/native_avcodec_videodecoder.h>
#include <multimedia/player_framework/native_avbuffer.h>
#include <multimedia/player_framework/native_avformat.h>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
struct Packet { std::vector<uint8_t> bytes; int64_t pts; uint32_t flags; };
struct Input { uint32_t index; OH_AVBuffer *buffer; };
class Decoder {
public:
    OH_AVCodec *codec = nullptr;
    OHNativeWindow *window = nullptr;
    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Packet> packets;
    std::deque<Input> inputs;
    std::atomic<bool> failed{false};
    std::atomic<uint32_t> presented{0};
    bool stopping = false;
    std::thread worker;
    static void Error(OH_AVCodec *, int32_t, void *ctx) { static_cast<Decoder *>(ctx)->failed = true; }
    static void Changed(OH_AVCodec *, OH_AVFormat *, void *) {}
    static void NeedInput(OH_AVCodec *, uint32_t index, OH_AVBuffer *buffer, void *ctx) {
        auto *self = static_cast<Decoder *>(ctx);
        std::lock_guard<std::mutex> lock(self->mutex);
        if (!self->stopping) { self->inputs.push_back({index, buffer}); self->wake.notify_one(); }
    }
    static void Output(OH_AVCodec *codec, uint32_t index, OH_AVBuffer *, void *ctx) {
        auto *self = static_cast<Decoder *>(ctx);
        if (OH_VideoDecoder_RenderOutputBuffer(codec, index) == AV_ERR_OK) ++self->presented;
        else self->failed = true;
    }
    bool Start(const std::string &surface, int32_t width, int32_t height) {
        uint64_t id = 0;
        try { id = std::stoull(surface); } catch (...) { return false; }
        if (OH_NativeWindow_CreateNativeWindowFromSurfaceId(id, &window) != 0 || !window) return false;
        codec = OH_VideoDecoder_CreateByMime("video/avc");
        if (!codec) return false;
        OH_AVCodecCallback callbacks{Error, Changed, NeedInput, Output};
        if (OH_VideoDecoder_RegisterCallback(codec, callbacks, this) != AV_ERR_OK) return false;
        OH_AVFormat *format = OH_AVFormat_Create();
        OH_AVFormat_SetIntValue(format, OH_MD_KEY_WIDTH, width);
        OH_AVFormat_SetIntValue(format, OH_MD_KEY_HEIGHT, height);
        const auto configured = OH_VideoDecoder_Configure(codec, format);
        OH_AVFormat_Destroy(format);
        if (configured != AV_ERR_OK || OH_VideoDecoder_SetSurface(codec, window) != AV_ERR_OK
            || OH_VideoDecoder_Prepare(codec) != AV_ERR_OK) return false;
        worker = std::thread([this]() { Run(); });
        return OH_VideoDecoder_Start(codec) == AV_ERR_OK;
    }
    void Run() {
        while (true) {
            Input input; Packet packet;
            {
                std::unique_lock<std::mutex> lock(mutex);
                wake.wait(lock, [this]() { return stopping || (!inputs.empty() && !packets.empty()); });
                if (stopping) return;
                input = inputs.front(); inputs.pop_front(); packet = std::move(packets.front()); packets.pop_front();
            }
            auto *address = OH_AVBuffer_GetAddr(input.buffer);
            const auto capacity = OH_AVBuffer_GetCapacity(input.buffer);
            if (!address || capacity < 0 || packet.bytes.size() > static_cast<size_t>(capacity)) { failed = true; continue; }
            std::memcpy(address, packet.bytes.data(), packet.bytes.size());
            OH_AVCodecBufferAttr attr{packet.pts, static_cast<int32_t>(packet.bytes.size()), 0, packet.flags};
            if (OH_AVBuffer_SetBufferAttr(input.buffer, &attr) != AV_ERR_OK
                || OH_VideoDecoder_PushInputBuffer(codec, input.index) != AV_ERR_OK) failed = true;
        }
    }
    ~Decoder() {
        { std::lock_guard<std::mutex> lock(mutex); stopping = true; packets.clear(); }
        wake.notify_all();
        if (worker.joinable()) worker.join();
        if (codec) { OH_VideoDecoder_Stop(codec); OH_VideoDecoder_Destroy(codec); }
        if (window) OH_NativeWindow_DestroyNativeWindow(window);
    }
};
std::unique_ptr<Decoder> decoder;
napi_value Boolean(napi_env env, bool ok) { napi_value result; napi_get_boolean(env, ok, &result); return result; }
napi_value Configure(napi_env env, napi_callback_info info) {
    napi_value args[3]; size_t argc = 3; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    decoder.reset();
    if (argc != 3) return Boolean(env, false);
    char surface[64]{}; size_t length = 0; int32_t width = 0, height = 0;
    if (napi_get_value_string_utf8(env, args[0], surface, sizeof(surface), &length) != napi_ok
        || napi_get_value_int32(env, args[1], &width) != napi_ok || napi_get_value_int32(env, args[2], &height) != napi_ok
        || width <= 0 || height <= 0 || width > 8192 || height > 8192) return Boolean(env, false);
    auto next = std::make_unique<Decoder>();
    if (!next->Start(std::string(surface, length), width, height)) return Boolean(env, false);
    decoder = std::move(next); return Boolean(env, true);
}
napi_value Push(napi_env env, napi_callback_info info) {
    napi_value args[3]; size_t argc = 3; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (!decoder || argc != 3 || decoder->failed) return Boolean(env, false);
    void *bytes = nullptr; size_t length = 0; double pts = 0; uint32_t flags = 0;
    if (napi_get_arraybuffer_info(env, args[0], &bytes, &length) != napi_ok || !bytes || !length || length > 4 * 1024 * 1024
        || napi_get_value_double(env, args[1], &pts) != napi_ok || napi_get_value_uint32(env, args[2], &flags) != napi_ok) return Boolean(env, false);
    std::lock_guard<std::mutex> lock(decoder->mutex);
    if (decoder->packets.size() >= 8) return Boolean(env, false);
    const auto *data = static_cast<uint8_t *>(bytes);
    uint32_t codecFlags = flags & 1 ? AVCODEC_BUFFER_FLAGS_CODEC_DATA : flags & 2 ? AVCODEC_BUFFER_FLAGS_SYNC_FRAME : AVCODEC_BUFFER_FLAGS_NONE;
    decoder->packets.push_back({std::vector<uint8_t>(data, data + length), static_cast<int64_t>(pts), codecFlags});
    decoder->wake.notify_one(); return Boolean(env, true);
}
napi_value Stop(napi_env env, napi_callback_info) { decoder.reset(); napi_value result; napi_get_undefined(env, &result); return result; }
napi_value Frames(napi_env env, napi_callback_info) { napi_value result; napi_create_uint32(env, decoder && !decoder->failed ? decoder->presented.load() : 0, &result); return result; }
napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {{"configure", nullptr, Configure, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"push", nullptr, Push, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"frames", nullptr, Frames, nullptr, nullptr, nullptr, napi_default, nullptr}};
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props); return exports;
}
napi_module module = {1, 0, nullptr, Init, "phonevideo", nullptr, {0}};
}
extern "C" __attribute__((constructor)) void RegisterPhoneVideo() { napi_module_register(&module); }
