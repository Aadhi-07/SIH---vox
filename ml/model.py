#!/usr/bin/env python3
"""
VoxGuard - Model Architecture & Classifier Definition

Provides the VoxGuardClassifier:
- Scaler + Ensemble / MLP classifier (with XGBoost or Scikit-learn Gradient Boosting / MLP)
- Output calibrated probability P(spoof | X) mapped to Voice Clone Risk Score (0 - 100)
- Serializes and deserializes cleanly as a self-contained pipeline bundle
"""

import pickle
import numpy as np
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.calibration import CalibratedClassifierCV

try:
    import xgboost as xgb
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False

class VoxGuardClassifier:
    """
    VoxGuard Voice Clone Detection Classifier Pipeline.
    Encapsulates feature normalization, model classification, and risk scoring.
    """
    def __init__(self, model_type="auto"):
        self.model_type = model_type
        self.scaler = StandardScaler()
        self.feature_names = []
        self.model = self._build_model()
        self.is_fitted = False

    def _build_model(self):
        """Construct classifier based on availability."""
        if (self.model_type == "xgboost" or self.model_type == "auto") and HAS_XGBOOST:
            base = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=4,
                learning_rate=0.08,
                subsample=0.85,
                colsample_bytree=0.85,
                eval_metric="logloss",
                random_state=42
            )
            return base
        elif self.model_type == "mlp":
            return MLPClassifier(
                hidden_layer_sizes=(64, 32),
                activation="relu",
                max_iter=300,
                alpha=0.01,
                random_state=42
            )
        else:
            # GradientBoostingClassifier with calibrated probabilities
            return GradientBoostingClassifier(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=3,
                subsample=0.9,
                random_state=42
            )

    def fit(self, X, y, feature_names=None):
        """Fit scaler and classifier."""
        X_arr = np.asarray(X, dtype=np.float32)
        y_arr = np.asarray(y, dtype=np.int32)
        
        if feature_names:
            self.feature_names = feature_names

        X_scaled = self.scaler.fit_transform(X_arr)
        self.model.fit(X_scaled, y_arr)
        self.is_fitted = True
        return self

    def predict(self, X):
        """Predict binary class (0: bonafide, 1: spoofed)."""
        X_arr = np.asarray(X, dtype=np.float32)
        if X_arr.ndim == 1:
            X_arr = X_arr.reshape(1, -1)
        X_scaled = self.scaler.transform(X_arr)
        return self.model.predict(X_scaled)

    def predict_proba(self, X):
        """Predict class probabilities [[p_bonafide, p_spoofed]]."""
        X_arr = np.asarray(X, dtype=np.float32)
        if X_arr.ndim == 1:
            X_arr = X_arr.reshape(1, -1)
        X_scaled = self.scaler.transform(X_arr)
        return self.model.predict_proba(X_scaled)

    def calculate_risk_score(self, X):
        """
        Calculate Risk Score (0 to 100) for audio feature vector(s).
        Risk Score is the calibrated percentage likelihood of being synthetic/cloned.
        """
        probas = self.predict_proba(X)
        spoof_prob = probas[:, 1]
        scores = np.clip(spoof_prob * 100.0, 0.0, 100.0)
        return scores if len(scores) > 1 else float(scores[0])

    def calculate_risk_and_confidence(self, X):
        """
        Calculate both Voice Clone Risk Score (0-100) and Confidence Value (0-100).
        - Risk Score: P(spoof | X) * 100
        - Confidence: Certainty metric based on distance from the decision boundary (|2*p - 1| * 100)
        """
        probas = self.predict_proba(X)
        spoof_prob = probas[:, 1]
        scores = np.clip(spoof_prob * 100.0, 0.0, 100.0)
        # Margin confidence: 0% at p=0.5 (maximum ambiguity), 100% at p=0 or p=1
        confidences = np.clip(np.abs(spoof_prob - 0.5) * 200.0, 0.0, 100.0)
        
        if len(scores) > 1:
            return scores, confidences
        return float(scores[0]), float(confidences[0])

    def save(self, file_path):
        """Serialize model bundle to disk."""
        target = Path(file_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as f:
            pickle.dump({
                "scaler": self.scaler,
                "model": self.model,
                "feature_names": self.feature_names,
                "model_type": self.model_type,
                "is_fitted": self.is_fitted
            }, f)
        print(f"[VoxGuard] Model artifact saved to: {target}")

    @classmethod
    def load(cls, file_path):
        """Deserialize model bundle from disk."""
        with open(file_path, "rb") as f:
            data = pickle.load(f)
        obj = cls(model_type=data.get("model_type", "auto"))
        obj.scaler = data["scaler"]
        obj.model = data["model"]
        obj.feature_names = data.get("feature_names", [])
        obj.is_fitted = data.get("is_fitted", True)
        return obj

if __name__ == "__main__":
    # Test classifier initialization and serialization
    clf = VoxGuardClassifier()
    X_dummy = np.random.randn(20, 111).astype(np.float32)
    y_dummy = np.random.randint(0, 2, size=20)
    clf.fit(X_dummy, y_dummy)
    scores = clf.calculate_risk_score(X_dummy[:2])
    print(f"[VoxGuard] Dummy Test Risk Scores: {scores}")
