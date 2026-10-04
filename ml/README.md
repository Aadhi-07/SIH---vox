# Formant Machine Learning Subsystem

Formant's ML pipeline extracts acoustic, spectral, and prosodic features from streaming audio chunks and performs real-time classification to distinguish bonafide human speech from synthetic/cloned speech.

---

## 1. Prototype Evaluation & Honest Metrics

The following metrics are derived from the held-out test split evaluated after training and automatically recorded in [`ml/artifacts/metrics.json`](file:///z:/attendX/vox/ml/artifacts/metrics.json).

> **Important Disclosure:**
> These metrics represent a **prototype-scale result** under controlled experimental conditions. While the model achieves high classification accuracy on this curated benchmark, this should **not be interpreted as a production-grade guarantee** against adversarial, compressed, or noisy in-the-wild voice cloning attacks.

### Real Benchmark Numbers (Held-out Test Split)
- **Model Type**: XGBoost Classifier (`XGBClassifier`)
- **Total Dataset Size**: $N = 142$ audio chunks ($106$ training samples, $36$ held-out test samples)
- **Class Distribution**:
  - Bonafide: $41$ samples ($10$ in test set)
  - Spoofed / Cloned: $101$ samples ($26$ in test set)
- **Dataset Setup**: ASVspoof 2019 LA subset & synthesized prototype speech dataset ($16\,\text{kHz}$, 2.0s rolling windows with 0.5s hop)
- **Training Environment**: CPU-only training
- **Feature Vector**: 111-dimensional feature vector combining:
  - 13 MFCCs + $\Delta$ (delta) + $\Delta\Delta$ (delta-delta) with summary statistics (mean, std, skew, kurtosis)
  - Spectral Flatness, Spectral Centroid, and Spectral Contrast across 6 frequency sub-bands
  - Prosodic & vocal tract features via Praat (`parselmouth`): F0 pitch statistics, Local Jitter, Local Shimmer, and Harmonics-to-Noise Ratio (HNR)

### Evaluated Performance
| Metric | Value | Note |
| :--- | :--- | :--- |
| **Accuracy** | **100.00%** | $36 / 36$ test chunks correctly classified |
| **Precision** | **100.00%** | Zero false positives on test split |
| **Recall** | **100.00%** | Zero false negatives on test split |
| **F1-Score** | **1.0000** | Balanced harmonic mean on test split |
| **ROC-AUC** | **1.0000** | Perfect separation on prototype test split |

### Confusion Matrix on Test Split
```
                Predicted Bonafide    Predicted Spoofed
Actual Bonafide         10                   0     (TN=10, FP=0)
Actual Spoofed           0                  26     (FN=0,  TP=26)
```

---

## 2. Confidence Score Derivation
Rather than only returning a binary decision or raw risk score, the model exposes `predict_proba` to calculate a **calibrated confidence score** ($0 - 100\%$):
$$\text{risk\_score} = P(\text{spoofed}) \times 100$$
$$\text{confidence} = |2 \cdot P(\text{spoofed}) - 1| \times 100$$

When the model is near the decision threshold ($P = 0.50$), confidence is $0\%$. When the model is strongly confident in either direction ($P \to 0$ or $P \to 1$), confidence approaches $100\%$.

---

## 3. Retraining Instructions
To retrain the model and regenerate `metrics.json`:
```powershell
& ".\.tools\python\python.exe" "ml\train.py"
```
The script will reload all audio from `data/bonafide` and `data/spoofed`, re-extract 111-dimensional feature vectors, train the XGBoost classifier, evaluate on the stratified $25\%$ test split, and persist both `ml/artifacts/model.pkl` and `ml/artifacts/metrics.json`.
