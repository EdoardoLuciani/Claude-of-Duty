"""Offline AX338 photo diagnostics; reference images are review-only, not shipped.
Frozen registration is committed separately; never fit the after render here.
python3 tools/ax338-photo-diff.py --photos PATH --before PATH --after PATH --out PATH
Requires Pillow/NumPy offline only. RGB differences are NOT a fidelity score.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
for name in ('photos','before','after','out'):p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--registration',type=Path,default=ROOT/'assets/weapons/ax338/photo-review.json')
p.add_argument('--region',help='Only include this named region in the close-up board (e.g. stock)')
args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
views=json.loads(args.registration.read_text());font=ImageFont.load_default(size=17);rows=[];regional_rows=[];report=[]
def metrics(reference,model,roi):
    intersection=np.count_nonzero(roi & reference & model);union=np.count_nonzero(roi & (reference|model))
    return {'mask_iou':float(intersection/max(1,union)),'mask_disagreement_pixels':int(np.count_nonzero(roi & (reference^model))),'roi_pixels':int(np.count_nonzero(roi))}
for v in views:
    ref=Image.open(args.photos/v['file']).convert('RGB');w,h=ref.size
    assert [w,h]==v['image_size'],'Reference dimensions changed; registration must not silently stretch'
    assert hashlib.sha256(ref.tobytes()).hexdigest()==v['rgb_sha256'],'Reference pixels changed; do not reuse frozen registration silently'
    rgb=np.array(ref);refmask=np.min(rgb,axis=2)<235
    roi=np.zeros((h,w),bool);x,y,xx,yy=v['roi'];roi[y:yy,x:xx]=True
    for x0,y0,x1,y1 in v['exclude']:roi[y0:y1,x0:x1]=False
    masks=[];images=[ref];m={'view':v['name'],'registration':v['registration'],'source':v['source'],'roi':v['roi'],'exclude':v['exclude'],'reference_threshold':235,'intentional_differences':v['intentional_differences'],'interpretation':'Silhouette diagnostic includes inferred orthographic camera, photo lighting, AA and source limits. No independent X/Y scale, elastic warping or after-only reframing. RGB delta is lighting-sensitive, not a fidelity score.'}
    for name,folder in [('before',args.before),('after',args.after)]:
        im=Image.open(folder/(v['name']+'.png')).convert('RGBA');assert im.size==(w,h)
        mask=np.array(im)[:,:,3]>127;masks.append(mask)
        images.append(Image.alpha_composite(Image.new('RGBA',(w,h),'white'),im).convert('RGB'))
        m[name]=metrics(refmask,mask,roi);m[name]['regions']={}
        for region,(rx,ry,rxx,ryy) in v['regions'].items():
            local=np.zeros((h,w),bool);local[ry:ryy,rx:rxx]=True;local &= roi
            m[name]['regions'][region]=metrics(refmask,mask,local)
    overlay=np.full((h,w,3),255,dtype=np.uint8)
    overlay[roi & refmask & masks[1]]=(75,84,95);overlay[roi & refmask & ~masks[1]]=(0,175,205);overlay[roi & ~refmask & masks[1]]=(240,75,100)
    images.append(Image.fromarray(overlay))
    delta=np.clip(np.abs(np.array(images[2]).astype(float)-rgb)*2,0,255).astype('uint8');delta[~roi]=255;images.append(Image.fromarray(delta))
    board=Image.new('RGB',(2560,300),(23,27,34));draw=ImageDraw.Draw(board)
    draw.text((14,12),v['name']+' | frozen uniform-scale camera | cyan=missing / red=extra | RGB delta is lighting-sensitive',fill='white',font=font)
    for i,(im,label) in enumerate(zip(images,['AX338 brochure','Before','After','Silhouette disagreement','RGB delta x2'])):
        draw.text((i*512+10,48),label,fill='white',font=font)
        crop=im.crop(tuple(v['roi']));crop.thumbnail((502,490));board.paste(crop,(i*512+5,83))
    draw.text((14,231),f"ROI mask IoU: {m['before']['mask_iou']:.3f} -> {m['after']['mask_iou']:.3f}; mismatch: {m['before']['mask_disagreement_pixels']:,} -> {m['after']['mask_disagreement_pixels']:,} pixels.",fill='white',font=font)
    draw.text((14,263),'Not CAD certification or pixel-perfect proof. Accessory/pose exclusions and regional metrics are recorded in metrics.json.',fill='#bfc8d5',font=font)
    board.save(args.out/(v['name']+'.png'));rows.append(board);report.append(m)
    for name,box in v['regions'].items():
        if args.region and args.region!=name:continue
        regional=Image.new('RGB',(1600,340),(23,27,34));d=ImageDraw.Draw(regional)
        a=m['before']['regions'][name]['mask_iou'];b=m['after']['regions'][name]['mask_iou']
        d.text((12,8),f"{v['name']} / {name} | mask IoU {a:.3f} -> {b:.3f} | documented exclusions still apply",fill='white',font=font)
        for i,(im,label) in enumerate(zip(images[:4],['AX338 brochure','Before','After','Silhouette delta'])):
            d.text((i*400+12,40),label,fill='white',font=font)
            crop=im.crop(tuple(box));scale=min(380/crop.width,260/crop.height)
            crop=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.NEAREST)
            regional.paste(crop,(i*400+10,70))
        d.text((12,320),'Enlarged diagnostic only; all metrics use the original reference pixel grid.',fill='#bfc8d5',font=font)
        regional_rows.append(regional)
(args.out/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
overview=Image.new('RGB',(2560,sum(row.height for row in rows)),(23,27,34));y=0
for row in rows:overview.paste(row,(0,y));y+=row.height
overview.save(args.out/'overview.png')
regions=Image.new('RGB',(1600,sum(row.height for row in regional_rows)),(23,27,34));y=0
for row in regional_rows:regions.paste(row,(0,y));y+=row.height
assert regional_rows,'No matching region'
regions.save(args.out/((args.region or 'regions')+'.png'));print(json.dumps(report,indent=2))
