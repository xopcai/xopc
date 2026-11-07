import socket
import sys
import types
import unittest
from unittest.mock import Mock, patch

from docker_host import available_port, install_macos_docker_provider


class DockerHostTest(unittest.TestCase):
    def test_live_port_and_reserved_docker_ports_are_skipped_without_process_enumeration(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            if port >= 65352:
                self.skipTest("OS assigned a port outside the provider range")
            selected = available_port(port, {port + 1})
            self.assertNotEqual(selected, port)
            self.assertNotEqual(selected, port + 1)

    def test_exhausted_port_range_is_an_explicit_failure(self):
        with self.assertRaisesRegex(RuntimeError, "NO_AVAILABLE_PORT"):
            available_port(65354, set())

    def test_macos_provider_checks_cleanup_and_preserves_ownership_on_a_swallowed_failure(self):
        class AccessDenied(Exception):
            pass
        class NotFound(Exception):
            pass
        class Original:
            def _get_used_ports(self):
                raise AccessDenied()
            def _create_container(self, **kwargs):
                return kwargs
            def stop_emulator(self, *args, **kwargs):
                self.container = None
        names = ["desktop_env", "desktop_env.providers", "desktop_env.providers.docker",
                 "desktop_env.providers.docker.provider", "docker", "docker.errors", "psutil"]
        modules = {name: types.ModuleType(name) for name in names}
        for name in names:
            if "." in name:
                parent, child = name.rsplit(".", 1)
                setattr(modules[parent], child, modules[name])
        module = modules["desktop_env.providers.docker.provider"]
        module.DockerProvider = Original
        modules["docker.errors"].NotFound = NotFound
        modules["psutil"].AccessDenied = AccessDenied
        with patch.dict(sys.modules, modules), patch("docker_host.platform.system", return_value="Darwin"):
            install_macos_docker_provider()
            provider = module.DockerProvider()
            owned = types.SimpleNamespace(id="owned-vm")
            provider.container = owned
            provider.client = Mock()
            provider.client.containers.list.return_value = [types.SimpleNamespace(attrs={
                "NetworkSettings": {"Ports": {"5000/tcp": [{"HostPort": "5000"}]}}})]
            self.assertEqual(provider._get_used_ports(), {5000})
            self.assertEqual(provider._create_container()["platform"], "linux/amd64")
            with self.assertRaisesRegex(RuntimeError, "CLEANUP_UNCONFIRMED"):
                provider.stop_emulator("fixture")
            self.assertIs(provider.container, owned)
            provider.client.containers.get.side_effect = NotFound()
            provider.stop_emulator("fixture")
            self.assertIsNone(provider.container)


if __name__ == "__main__":
    unittest.main()
