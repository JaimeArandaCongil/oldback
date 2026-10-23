"""Offline asset preparation only. The phone runs its own local WASM inference.

python -m pip install -r scripts/requirements-neural.txt
python scripts/build-neural-index.py
"""
import hashlib
import json
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'neural'
WORK = ROOT / '.generated' / 'neural-build'
URL = 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx'
SOURCE_SHA = 'c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5'
MEAN = np.array([.485, .456, .406], dtype=np.float32)
STD = np.array([.229, .224, .225], dtype=np.float32)
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def asset(prefix, suffix, data):
    name = prefix + '-' + sha(data)[:16] + suffix
    (OUT / name).write_bytes(data)
    return name

original = WORK / 'mobilenetv2-12.onnx'
if not original.exists():
    with urllib.request.urlopen(URL, timeout=90) as response:
        original.write_bytes(response.read())
assert sha(original.read_bytes()) == SOURCE_SHA, 'The model download does not match its published SHA256'
model = onnx.load(original)
pool = [node for node in model.graph.node if node.op_type == 'GlobalAveragePool'][-1]
extracted = WORK / 'embedding.onnx'
onnx.utils.extract_model(str(original), str(extracted), [model.graph.input[0].name], [pool.output[0]])
onnx.checker.check_model(str(extracted))
model_name = asset('mobilenetv2-features', '.onnx', extracted.read_bytes())
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(extracted), options, providers=['CPUExecutionProvider'])
input_name, output_name = session.get_inputs()[0].name, session.get_outputs()[0].name

def embed(image):
    rgb = np.asarray(image.convert('RGB').resize((224, 224), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    tensor = ((rgb - MEAN) / STD).transpose(2, 0, 1)[None].copy()
    vector = session.run([output_name], {input_name: tensor})[0].reshape(-1).astype(np.float32)
    return vector / max(float(np.linalg.norm(vector)), 1e-10)

catalog = json.loads((ROOT / 'src/data/catalog.json').read_text(encoding='utf-8'))
cards = [c for c in catalog['cards'] if c.get('image')]
identities = [{'id': c['id'], 'era': 'ecard' if c.get('era') == 'ecard' else 'oldback', 'image': c.get('fullImage') or c['image'], 'view': view} for c in cards for view in ['original', 'soft-focus']]
signature = sha(json.dumps(identities, ensure_ascii=False, separators=(',', ':')).encode())
image_hash = hashlib.sha256()
for c in cards:
    image_hash.update(c['id'].encode())
    image_hash.update((ROOT / 'public' / (c.get('fullImage') or c['image'])).read_bytes())
image_signature = image_hash.hexdigest()
cache = WORK / ('raw-' + sha((signature + image_signature + SOURCE_SHA + 'rgb224-bilinear-blur2at256-v2').encode())[:16] + '.f32')
started = time.perf_counter()
if cache.exists():
    raw = np.fromfile(cache, dtype='<f4').reshape(len(identities), -1)
else:
    vectors = []
    for i, c in enumerate(cards):
        with Image.open(ROOT / 'public' / (c.get('fullImage') or c['image'])) as image:
            vectors.append(embed(image))
            # A second catalog-only view covers modest optical defocus. No test
            # or user photographs enter the index or the PCA fit.
            soft = image.convert('RGB').resize((256, 360), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(2))
            vectors.append(embed(soft))
        if (i + 1) % 200 == 0:
            print(json.dumps({'prepared': i + 1, 'total': len(cards), 'seconds': round(time.perf_counter() - started, 1)}), flush=True)
    raw = np.array(vectors, dtype='<f4')
    raw.tofile(cache)
dimensions = 256
center = raw.mean(axis=0)
centered = raw - center
covariance = centered.T @ centered / (len(identities) - 1)
values, axes = np.linalg.eigh(covariance)
order = np.argsort(values)[::-1][:dimensions]
# Partial whitening reduces common layout/color signals without amplifying tiny
# directions. This projection is fitted only on catalog reference photographs.
projection = (axes[:, order] / np.maximum(values[order], values[order[0]] * .01) ** .25).T.astype('<f4')
projected = centered @ projection.T
projected /= np.maximum(np.linalg.norm(projected, axis=1, keepdims=True), 1e-10)
vectors_name = asset('vectors', '.f16', projected.astype('<f2').tobytes())
projection_name = asset('projection', '.f32', np.concatenate([center, projection.reshape(-1)]).astype('<f4').tobytes())
index_name = asset('index', '.json', json.dumps(identities, ensure_ascii=False, separators=(',', ':')).encode())
manifest = {'schema': 1, 'model': model_name, 'modelSha256': sha(extracted.read_bytes()), 'sourceModelSha256': SOURCE_SHA, 'sourceUrl': URL,
            'license': 'Apache-2.0', 'runtime': 'runtime-1.30.0', 'inputName': input_name, 'outputName': output_name,
            'input': {'width': 224, 'height': 224, 'layout': 'NCHW', 'resize': 'stretch-whole-card', 'mean': MEAN.tolist(), 'std': STD.tolist()},
            'rawDimensions': raw.shape[1], 'dimensions': dimensions, 'count': len(cards), 'vectorCount': len(identities), 'vectors': vectors_name,
            'projection': projection_name, 'index': index_name, 'catalogSignature': signature, 'catalogImageSignature': image_signature,
            'training': 'ImageNet-pretrained visual features; catalog-only PCA; no shop-photo training or calibrated probabilities'}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
if not (OUT / 'LICENSE-model.txt').exists():
    with urllib.request.urlopen('https://raw.githubusercontent.com/onnx/models/main/LICENSE', timeout=30) as response:
        (OUT / 'LICENSE-model.txt').write_bytes(response.read())

# Retrieval-only sanity benchmark. Full hybrid/ORB comparison runs in browser
# using the identical crop and effects for each method, including negatives.
samples = ['base-37251', 'base-37254', 'jungle-37400', 'fossil-37510', 'e1-001', 'e2-004', 'e3-090', 'e5-091']
tests = []
for c in [c for c in cards if c['id'] in samples]:
    with Image.open(ROOT / 'public' / (c.get('fullImage') or c['image'])) as original_image:
        original_image = original_image.convert('RGB').resize((256, 360), Image.Resampling.BILINEAR)
    for effect in ['clean', 'blur', 'label', 'glare']:
        image = original_image.copy()
        if effect == 'blur': image = image.filter(ImageFilter.GaussianBlur(3))
        if effect == 'label':
            draw = ImageDraw.Draw(image); draw.rectangle((70, 250, 245, 330), fill='white'); draw.text((85, 270), 'Y 12,800', fill='black')
        if effect == 'glare':
            layer = Image.new('RGB', image.size, 'white'); mask = Image.new('L', image.size, 0); ImageDraw.Draw(mask).ellipse((60, 55, 245, 220), fill=220); mask = mask.filter(ImageFilter.GaussianBlur(12)); image = Image.composite(layer, image, mask)
        v = (embed(image) - center) @ projection.T; v /= max(float(np.linalg.norm(v)), 1e-10)
        scores = projected @ v
        scores = scores.reshape(len(cards), 2).max(axis=1)
        ranking = np.argsort(-scores).tolist()
        rank = ranking.index(cards.index(c)) + 1
        tests.append({'id': c['id'], 'effect': effect, 'rank': rank, 'score': round(float(scores[cards.index(c)]), 4)})
(WORK / 'retrieval-sanity.json').write_text(json.dumps(tests, indent=2), encoding='utf-8')
print(json.dumps({'modelBytes': (OUT / model_name).stat().st_size, 'vectorBytes': (OUT / vectors_name).stat().st_size,
                  'projectionBytes': (OUT / projection_name).stat().st_size, 'count': len(cards), 'seconds': round(time.perf_counter() - started, 1),
                  'sanityTop20': sum(t['rank'] <= 20 for t in tests), 'sanityCases': len(tests)}), flush=True)
