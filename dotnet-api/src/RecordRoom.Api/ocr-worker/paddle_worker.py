"""Run one PP-OCRv5 CPU pipeline and accept one image path per JSON line."""

import argparse
import json
import os
from pathlib import Path
import sys
import traceback


DETECTOR = "PP-OCRv5_mobile_det"
RECOGNIZER = "devanagari_PP-OCRv5_mobile_rec"


def load_pipeline():
    if os.environ.get("RR_PADDLE_MODEL_DIR"):
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCR

    model_root = os.environ.get("RR_PADDLE_MODEL_DIR")
    paths = {}
    if model_root:
        for option, name in (("text_detection", DETECTOR), ("text_recognition", RECOGNIZER)):
            model_dir = Path(model_root) / name
            if not model_dir.is_dir():
                raise FileNotFoundError(f"Missing PaddleOCR model: {model_dir}")
            paths[f"{option}_model_dir"] = str(model_dir)

    return PaddleOCR(
        text_detection_model_name=DETECTOR,
        text_recognition_model_name=RECOGNIZER,
        device="cpu",
        cpu_threads=int(os.environ.get("RR_PADDLE_CPU_THREADS", "2")),
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_det_limit_type="max",
        text_det_limit_side_len=2048,
        text_recognition_batch_size=4,
        **paths,
    )


def recognize(pipeline, path):
    import cv2
    import numpy as np

    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The stored scan is not a readable image.")
    lines = (line.strip() for page in pipeline.predict_iter(image) for line in page["rec_texts"])
    return "\n".join(line for line in lines if line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--warmup", action="store_true", help="Load the models and exit.")
    args = parser.parse_args()

    # Keep Python and native-library diagnostic output off the protocol stream.
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1) as protocol:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

        def reply(**response):
            print(json.dumps(response, ensure_ascii=False), file=protocol, flush=True)

        try:
            pipeline = load_pipeline()
        except Exception as error:
            traceback.print_exc()
            reply(error=f"{type(error).__name__}: {error}")
            return 1
        reply(ready=True)
        if args.warmup:
            return 0

        for request in sys.stdin:
            try:
                text = recognize(pipeline, json.loads(request))
                reply(text=text)
            except Exception as error:
                traceback.print_exc()
                reply(error=f"{type(error).__name__}: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
