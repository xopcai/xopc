use snow::Builder;

#[test]
fn matches_cacophony_independent_implementation_vector() {
    let v: serde_json::Value = serde_json::from_str(include_str!("cacophony-nk.json")).unwrap();
    let bytes = |field: &str| hex::decode(v[field].as_str().unwrap()).unwrap();
    let public = bytes("init_remote_static");
    let private = bytes("resp_static");
    let ie = bytes("init_ephemeral");
    let re = bytes("resp_ephemeral");
    let ip = bytes("init_prologue");
    let rp = bytes("resp_prologue");
    let suite = v["protocol_name"].as_str().unwrap();
    let mut client = Builder::new(suite.parse().unwrap()).remote_public_key(&public).unwrap()
        .fixed_ephemeral_key_for_testing_only(&ie).prologue(&ip).unwrap().build_initiator().unwrap();
    let mut server = Builder::new(suite.parse().unwrap()).local_private_key(&private).unwrap()
        .fixed_ephemeral_key_for_testing_only(&re).prologue(&rp).unwrap().build_responder().unwrap();
    let mut wire = [0u8; 65535];
    let mut clear = [0u8; 65535];
    let messages = v["messages"].as_array().unwrap();
    for (i, message) in messages.iter().take(2).enumerate() {
        let payload = hex::decode(message["payload"].as_str().unwrap()).unwrap();
        let (sender, receiver) = if i == 0 { (&mut client, &mut server) } else { (&mut server, &mut client) };
        let n = sender.write_message(&payload, &mut wire).unwrap();
        assert_eq!(hex::encode(&wire[..n]), message["ciphertext"].as_str().unwrap());
        let m = receiver.read_message(&wire[..n], &mut clear).unwrap();
        assert_eq!(clear[..m], payload);
    }
    let mut client = client.into_transport_mode().unwrap();
    let mut server = server.into_transport_mode().unwrap();
    for (i, message) in messages.iter().skip(2).enumerate() {
        let payload = hex::decode(message["payload"].as_str().unwrap()).unwrap();
        let (sender, receiver) = if i % 2 == 0 { (&mut client, &mut server) } else { (&mut server, &mut client) };
        let n = sender.write_message(&payload, &mut wire).unwrap();
        assert_eq!(hex::encode(&wire[..n]), message["ciphertext"].as_str().unwrap());
        let m = receiver.read_message(&wire[..n], &mut clear).unwrap();
        assert_eq!(clear[..m], payload);
    }
}
