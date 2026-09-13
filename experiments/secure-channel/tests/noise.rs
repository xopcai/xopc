use snow::{Builder, HandshakeState, TransportState};

const SUITE: &str = "Noise_NK_25519_ChaChaPoly_BLAKE2s";
const PROLOGUE: &[u8] = b"xopc-secure-channel-probe-v1";

fn handshakes(wrong_key: bool) -> (HandshakeState, HandshakeState) {
    let keys = Builder::new(SUITE.parse().unwrap()).generate_keypair().unwrap();
    let other = Builder::new(SUITE.parse().unwrap()).generate_keypair().unwrap();
    let initiator = Builder::new(SUITE.parse().unwrap()).prologue(PROLOGUE).unwrap()
        .remote_public_key(if wrong_key { &other.public } else { &keys.public }).unwrap()
        .build_initiator().unwrap();
    let responder = Builder::new(SUITE.parse().unwrap()).prologue(PROLOGUE).unwrap()
        .local_private_key(&keys.private).unwrap().build_responder().unwrap();
    (initiator, responder)
}

fn transport() -> (TransportState, TransportState) {
    let (mut client, mut server) = handshakes(false);
    let mut wire = [0u8; 65535];
    let mut clear = [0u8; 65535];
    // No device credentials before the responder's authenticated handshake completes.
    let n = client.write_message(&[], &mut wire).unwrap();
    server.read_message(&wire[..n], &mut clear).unwrap();
    let n = server.write_message(&[], &mut wire).unwrap();
    client.read_message(&wire[..n], &mut clear).unwrap();
    assert_eq!(client.get_handshake_hash(), server.get_handshake_hash());
    (client.into_transport_mode().unwrap(), server.into_transport_mode().unwrap())
}

#[test]
fn refuses_an_untrusted_server_key() {
    let (mut client, mut server) = handshakes(true);
    let mut wire = [0u8; 65535];
    let n = client.write_message(&[], &mut wire).unwrap();
    assert!(server.read_message(&wire[..n], &mut [0u8; 65535]).is_err());
}

#[test]
fn protects_method_path_credentials_and_body_together() {
    let (mut client, mut server) = transport();
    let request = b"POST /api/sessions/test/inputs\nAuthorization: secret\nprivate input";
    let mut wire = [0u8; 65535];
    let mut clear = [0u8; 65535];
    let n = client.write_message(request, &mut wire).unwrap();
    assert!(!wire[..n].windows(6).any(|v| v == b"secret"));
    let m = server.read_message(&wire[..n], &mut clear).unwrap();
    assert_eq!(&clear[..m], request);
    let n = server.write_message(b"private response", &mut wire).unwrap();
    let m = client.read_message(&wire[..n], &mut clear).unwrap();
    assert_eq!(&clear[..m], b"private response");
}

#[test]
fn rejects_tampering_replay_reordering_and_cross_session_frames() {
    for attack in 0..4 {
        let (mut client, mut server) = transport();
        let mut wire = [0u8; 65535];
        let n = client.write_message(b"one", &mut wire).unwrap();
        match attack {
            0 => wire[0] ^= 1,
            1 => { server.read_message(&wire[..n], &mut [0u8; 65535]).unwrap(); }
            2 => { client.write_message(b"two", &mut wire).unwrap(); }
            _ => { server = transport().1; }
        }
        assert!(server.read_message(&wire[..n], &mut [0u8; 65535]).is_err());
    }
}

#[test]
fn handles_100_mib_in_fixed_buffers_with_interleaved_voice() {
    let (mut client, mut server) = transport();
    let mut wire = [0u8; 32784];
    let mut clear = [0u8; 32768];
    let mut chunk = [0u8; 32768];
    for index in 0..3200 {
        chunk.fill((index % 251) as u8);
        let n = client.write_message(&chunk, &mut wire).unwrap();
        let m = server.read_message(&wire[..n], &mut clear).unwrap();
        assert_eq!(&clear[..m], chunk);
        let n = server.write_message(b"voice frame", &mut wire).unwrap();
        let m = client.read_message(&wire[..n], &mut clear).unwrap();
        assert_eq!(&clear[..m], b"voice frame");
    }
}

#[test]
fn rejects_protocol_size_overflow() {
    let (mut client, _) = transport();
    assert!(client.write_message(&[0u8; 65520], &mut [0u8; 65536]).is_err());
}
