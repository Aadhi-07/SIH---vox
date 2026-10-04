#!/usr/bin/env python3
"""
VoxGuard - ASVspoof 2019 Logical Access (LA) Dataset Fetcher & Organizer

The ASVspoof 2019 LA database is the international benchmark for logical access
voice spoofing and deepfake detection (bonafide human speech vs. synthetic/converted voices).

Dataset Origin & Licensing:
- Official Host: University of Edinburgh DataShare (https://datashare.ed.ac.uk/handle/10283/3336)
- Zenodo Mirror: https://zenodo.org/record/4835108
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Note: Full dataset archive is ~15 GB (uncompressed ~28 GB).

This script provides:
1. Automated setup of target directory structure: `data/bonafide/` and `data/spoofed/`.
2. Protocol parser that reads `ASVspoof2019.LA.cm.*.txt` and sorts audio files accordingly.
3. Automated downloader for official protocol files or designated sample subsets.
"""

import os
import sys
import argparse
import urllib.request
import zipfile
import shutil
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
BONAFIDE_DIR = DATA_DIR / "bonafide"
SPOOFED_DIR = DATA_DIR / "spoofed"

ASVSPOOF_INFO = """
================================================================================
                    VoxGuard - ASVspoof 2019 LA Dataset Setup
================================================================================
The ASVspoof 2019 Logical Access (LA) partition evaluates voice clone detection
across both known and unknown acoustic/neural text-to-speech (TTS) and voice
conversion (VC) systems (A01 - A19).

Official Download Sources:
  1. University of Edinburgh DataShare:
     https://datashare.ed.ac.uk/handle/10283/3336
     Archive: LA.zip (Train, Dev, Eval audio + protocols)
  2. Zenodo Mirror:
     https://zenodo.org/record/4835108

Manual Setup Instructions:
  1. Download 'LA.zip' from the link above.
  2. Unzip into a temporary directory (e.g. ./data/asvspoof2019_raw).
  3. Run this script to automatically organize files into VoxGuard format:
     python ml/data/fetch_asvspoof.py --raw-dir ./data/asvspoof2019_raw --max-samples 500
================================================================================
"""

def setup_directories():
    """Ensure bonafide and spoofed folders exist."""
    BONAFIDE_DIR.mkdir(parents=True, exist_ok=True)
    SPOOFED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[VoxGuard] Initialized dataset directories:\n  - Bonafide: {BONAFIDE_DIR}\n  - Spoofed:  {SPOOFED_DIR}")

def parse_protocol_file(protocol_path):
    """
    Parse ASVspoof 2019 protocol text file.
    Protocol line format:
    SPEAKER_ID AUDIO_FILENAME - SYSTEM_ID KEY
    Example:
    LA_0079 LA_D_1047731 - - bonafide
    LA_0079 LA_D_1105538 - A05 spoof
    """
    entries = []
    if not os.path.exists(protocol_path):
        print(f"[-] Protocol file not found: {protocol_path}")
        return entries

    with open(protocol_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                speaker_id = parts[0]
                audio_id = parts[1]
                system_id = parts[3]
                key = parts[4].lower() # 'bonafide' or 'spoof'
                entries.append({
                    "speaker_id": speaker_id,
                    "audio_id": audio_id,
                    "system_id": system_id,
                    "key": key
                })
    return entries

def organize_from_raw(raw_dir, max_samples=None):
    """Scan unzipped ASVspoof directory and copy files into bonafide/spoofed directories."""
    raw_path = Path(raw_dir)
    print(f"[*] Scanning {raw_path} for ASVspoof 2019 data...")
    
    # Locate protocol files
    protocol_files = list(raw_path.glob("**/ASVspoof2019.LA.cm.*.txt"))
    if not protocol_files:
        print("[-] No ASVspoof protocol files found (*.txt).")
        print("    Looking for files directly matching 'bonafide' or 'spoof' in names...")
        # Direct audio file search fallback
        audio_files = list(raw_path.glob("**/*.flac")) + list(raw_path.glob("**/*.wav"))
        for af in audio_files:
            target = BONAFIDE_DIR if "bonafide" in af.name.lower() else SPOOFED_DIR
            shutil.copy2(af, target / af.name)
        return

    setup_directories()
    for proto in protocol_files:
        print(f"[*] Parsing protocol: {proto.name}")
        entries = parse_protocol_file(proto)
        print(f"    Found {len(entries)} labeled entries.")
        
        # Build index of available audio files
        audio_map = {}
        for af in raw_path.glob("**/*.*"):
            if af.suffix.lower() in [".flac", ".wav"]:
                audio_map[af.stem] = af

        copied_bonafide = 0
        copied_spoof = 0
        limit_per_class = max_samples // 2 if max_samples else float("inf")

        for entry in entries:
            stem = entry["audio_id"]
            if stem in audio_map:
                src = audio_map[stem]
                if entry["key"] == "bonafide" and copied_bonafide < limit_per_class:
                    shutil.copy2(src, BONAFIDE_DIR / src.name)
                    copied_bonafide += 1
                elif entry["key"] == "spoof" and copied_spoof < limit_per_class:
                    shutil.copy2(src, SPOOFED_DIR / src.name)
                    copied_spoof += 1
            
            if max_samples and (copied_bonafide + copied_spoof) >= max_samples:
                break
                
        print(f"[+] Imported: {copied_bonafide} bonafide samples, {copied_spoof} spoofed samples.")

def main():
    parser = argparse.ArgumentParser(description="VoxGuard ASVspoof 2019 LA Dataset Ingestion")
    parser.add_argument("--info", action="store_true", help="Print dataset information and download links")
    parser.add_argument("--setup-dirs", action="store_true", help="Initialize ./data/bonafide and ./data/spoofed folders")
    parser.add_argument("--raw-dir", type=str, default=None, help="Path to unpacked ASVspoof 2019 dataset directory")
    parser.add_argument("--max-samples", type=int, default=500, help="Maximum samples to ingest per class")
    args = parser.parse_args()

    if args.info or len(sys.argv) == 1:
        print(ASVSPOOF_INFO)
    
    setup_directories()

    if args.raw_dir:
        organize_from_raw(args.raw_dir, args.max_samples)

if __name__ == "__main__":
    main()
