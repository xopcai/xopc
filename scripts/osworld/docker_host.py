"""Host-side Docker compatibility; guest image and evaluators remain unchanged."""
import platform
import socket


def available_port(start, used, socket_factory=socket.socket):
    for port in range(start, 65354):
        if port in used:
            continue
        try:
            with socket_factory(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
    raise RuntimeError("OSWORLD_NO_AVAILABLE_PORT")


def install_macos_docker_provider():
    if platform.system() != "Darwin":
        return "upstream"
    import psutil
    from docker.errors import NotFound
    import desktop_env.providers.docker.provider as module
    original = module.DockerProvider

    class MacDockerProvider(original):
        def _get_used_ports(self):
            try:
                return super()._get_used_ports()
            except psutil.AccessDenied:
                # macOS restricts system-wide socket enumeration. Reserve Docker
                # mappings and probe the host kernel instead of requiring sudo.
                ports = set()
                for container in self.client.containers.list():
                    for mappings in (container.attrs["NetworkSettings"]["Ports"] or {}).values():
                        ports.update(int(mapping["HostPort"]) for mapping in mappings or [])
                return ports

        def _get_available_port(self, start_port):
            return available_port(start_port, self._get_used_ports())

        def _create_container(self, **kwargs):
            # The official runtime and guest are x86; OrbStack can run the host
            # image in compatibility mode and QEMU then uses software emulation.
            kwargs["platform"] = "linux/amd64"
            return super()._create_container(**kwargs)

        def stop_emulator(self, *args, **kwargs):
            owned = self.container
            super().stop_emulator(*args, **kwargs)
            if owned is not None:
                try:
                    self.client.containers.get(owned.id)
                except NotFound:
                    return
                self.container = owned
                raise RuntimeError("OSWORLD_CLEANUP_UNCONFIRMED")

    module.DockerProvider = MacDockerProvider
    return "macos-port-probe-amd64-docker"
