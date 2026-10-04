#!/usr/bin/env python3
"""
Test script for Smart India Hackathon Prototype verification:
- Checks SIH scenario list endpoint (/sih/scenarios)
- Checks scenario simulation trigger (/sih/simulate/{id})
- Checks official I4C Forensic Evidence Dossier generation (/calls/{id}/dossier)
- Checks printable HTML report generation (/calls/{id}/dossier/html)
- Checks Human-in-the-Loop review and stats tracking
"""

import sys
import json
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
API_BASE = "http://127.0.0.1:8000"

def test_sih_endpoints():
    print("\n=======================================================")
    print("  VOXGUARD - SMART INDIA HACKATHON E2E PIPELINE TEST")
    print("=======================================================")

    # 1. Health check
    print("\n[+] Testing GET /health...")
    req = urllib.request.Request(f"{API_BASE}/health")
    with urllib.request.urlopen(req) as resp:
        health = json.loads(resp.read().decode())
    print(f"    Health Status: {health.get('status')} | Service: {health.get('service')}")
    assert health.get("status") == "healthy"

    # 2. SIH Scenarios
    print("\n[+] Testing GET /sih/scenarios...")
    req = urllib.request.Request(f"{API_BASE}/sih/scenarios")
    with urllib.request.urlopen(req) as resp:
        scenarios = json.loads(resp.read().decode())
    print(f"    Loaded {len(scenarios)} Indian Cyber Threat Scenarios:")
    for sc in scenarios:
        print(f"    - [{sc['id']}] {sc['title']} -> Expected: {sc['expected_risk']}")
    assert len(scenarios) >= 4

    # 3. Test I4C Forensic Evidence Dossier (JSON)
    print("\n[+] Testing GET /calls/call-digital-arrest/dossier...")
    req = urllib.request.Request(f"{API_BASE}/calls/call-digital-arrest/dossier")
    with urllib.request.urlopen(req) as resp:
        dossier = json.loads(resp.read().decode())
    print(f"    Incident ID:        {dossier['incident_id']}")
    print(f"    Authority:          {dossier['authority']}")
    print(f"    Verdict:            {dossier['forensic_classification']['verdict']}")
    print(f"    Risk Score:         {dossier['forensic_classification']['voice_clone_risk_score']}")
    print(f"    SHA-256 Hash:       {dossier['forensic_classification']['sha256_audio_fingerprint'][:24]}...")
    print(f"    Statute:            {dossier['statutory_sanctions']['governing_statute'][:60]}...")
    assert "I4C/VOX-IN" in dossier["incident_id"]
    assert "SYNTHETIC" in dossier["forensic_classification"]["verdict"]

    # 4. Test Printable HTML Report
    print("\n[+] Testing GET /calls/call-digital-arrest/dossier/html...")
    req = urllib.request.Request(f"{API_BASE}/calls/call-digital-arrest/dossier/html")
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode()
    print(f"    HTML Size: {len(html)} bytes")
    assert "INDIAN CYBERCRIME COORDINATION CENTRE" in html
    assert "FORENSIC VOICE-CLONE INCIDENT REFERRAL DOSSIER" in html
    assert "Section 66D IT Act" in html
    print("    [PASS] Printable HTML Dossier validated!")

    # 5. Test SIH Scenario Simulation
    print("\n[+] Testing POST /sih/simulate/sih-digital-arrest...")
    req = urllib.request.Request(
        f"{API_BASE}/sih/simulate/sih-digital-arrest",
        data=b"",
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        sim_res = json.loads(resp.read().decode())
    print(f"    Simulation started: {sim_res}")
    assert sim_res["status"] == "simulation_started"

    # 6. Test HITL Review Action
    print("\n[+] Testing POST /calls/call-digital-arrest/review (confirm_block)...")
    req = urllib.request.Request(
        f"{API_BASE}/calls/call-digital-arrest/review",
        data=json.dumps({"action": "confirm_block"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        rev_res = json.loads(resp.read().decode())
    print(f"    Review Action Result: Call Status = {rev_res['call_status']} | Stats = {rev_res['stats']}")
    assert rev_res["call_status"] == "BLOCKED"

    print("\n=======================================================")
    print("  ALL SMART INDIA HACKATHON BACKEND CHECKS PASSED!")
    print("=======================================================\n")

if __name__ == "__main__":
    test_sih_endpoints()
