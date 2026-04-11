from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class LoadedImage:
    rgb: np.ndarray  # HxWx3 uint8
    width: int
    height: int


def load_image_from_bytes(data: bytes) -> LoadedImage:
    img = Image.open(io_bytes_to_filelike(data)).convert("RGB")
    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    return LoadedImage(rgb=arr, width=w, height=h)


def io_bytes_to_filelike(data: bytes):
    import io

    return io.BytesIO(data)

