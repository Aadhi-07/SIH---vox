import asyncio
import json
import websockets

async def test_signaling():
    room_id = "test-signal-room"
    url = f"ws://127.0.0.1:8000/ws/signal/{room_id}"

    print(f"[*] Connecting Client 1 to {url}...")
    ws1 = await websockets.connect(url)
    msg1 = json.loads(await ws1.recv())
    print(f"[+] Client 1 received: {msg1}")
    assert msg1["type"] == "JOINED" and msg1["peer_count"] == 1

    print(f"[*] Connecting Client 2 to {url}...")
    ws2 = await websockets.connect(url)
    msg2 = json.loads(await ws2.recv())
    print(f"[+] Client 2 received: {msg2}")
    assert msg2["type"] == "JOINED" and msg2["peer_count"] == 2 and msg2["is_initiator"] is True

    peer_joined_msg = json.loads(await ws1.recv())
    print(f"[+] Client 1 notified: {peer_joined_msg}")
    assert peer_joined_msg["type"] == "PEER_JOINED"

    # Client 2 sends offer
    print("[*] Client 2 sending offer...")
    offer_payload = {"type": "offer", "sdp": "v=0\r\no=alice..."}
    await ws2.send(json.dumps(offer_payload))

    # Client 1 receives offer
    relayed_offer = json.loads(await ws1.recv())
    print(f"[+] Client 1 received relayed offer: {relayed_offer}")
    assert relayed_offer["type"] == "offer"

    # Client 1 sends answer
    print("[*] Client 1 sending answer...")
    answer_payload = {"type": "answer", "sdp": "v=0\r\no=bob..."}
    await ws1.send(json.dumps(answer_payload))

    # Client 2 receives answer
    relayed_answer = json.loads(await ws2.recv())
    print(f"[+] Client 2 received relayed answer: {relayed_answer}")
    assert relayed_answer["type"] == "answer"

    await ws1.close()
    await ws2.close()
    print("[+] WebRTC Signaling Verification PASSED!")

if __name__ == "__main__":
    asyncio.run(test_signaling())
