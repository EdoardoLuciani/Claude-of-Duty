"""Offline diagnostic boards; photo originals are review-only, never shipped.
python3 tools/m4-photo-diff.py --photos PATH --before PATH --after PATH --out PATH
Requires Pillow and NumPy in the offline review environment, not npm/runtime.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser()
for name in ('photos','before','after','out'):p.add_argument('--'+name,type=Path,required=True)
args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]
views=json.loads((root/'assets/weapons/m4a1-block-ii/photo-review.json').read_text())
font=ImageFont.load_default(size=18);small=ImageFont.load_default(size=14)
rows=[];metrics=[]
for v in views:
    ref=Image.open(args.photos/v['file']).convert('RGBA');w,h=ref.size
    assert [w,h]==v['image_size'],'different reference thumbnail; do not silently stretch'
    white=Image.new('RGBA',(w,h),'white');ref=Image.alpha_composite(white,ref).convert('RGB');a=np.array(ref)
    refmask=np.min(a,axis=2)<195
    roi=np.zeros((h,w),bool);x0,y0,x1,y1=v['roi'];roi[y0:y1,x0:x1]=True
    for x,y,xx,yy in v['exclude']:roi[y:yy,x:xx]=False
    images=[ref];masks=[]
    for folder in (args.before,args.after):
        im=Image.open(folder/(v['name']+'.png')).convert('RGBA');masks.append(np.array(im)[:,:,3]>127)
        images.append(Image.alpha_composite(white,im).convert('RGB'))
    d=np.full((h,w,3),255,dtype=np.uint8)
    d[roi & refmask & masks[1]]=[78,87,99]
    d[roi & refmask & ~masks[1]]=[0,175,205]
    d[roi & ~refmask & masks[1]]=[240,75,100];images.append(Image.fromarray(d))
    rgbdiff=np.clip(np.abs(np.array(images[2]).astype(float)-a)*2,0,255).astype('uint8')
    rgbdiff[~roi]=255;images.append(Image.fromarray(rgbdiff))
    m={'view':v['name'],'camera_landmark_rms_pixels':v['landmark_rms_pixels'],'roi':v['roi'],'excluded_accessories':v['exclude'],'threshold':195,'interpretation':'threshold-mask diagnostic includes camera/lighting/source limitations; RGB difference is not a fidelity score'}
    for state,mask in zip(('before','after'),masks):
        union=np.count_nonzero(roi & (refmask|mask));inter=np.count_nonzero(roi & refmask & mask)
        m[state]={'mask_disagreement_pixels':int(np.count_nonzero(roi & (refmask^mask))),'mask_iou':float(inter/max(1,union))}
    metrics.append(m)
    box=(max(0,x0-20),max(0,y0-20),min(w,x1+20),min(h,y1+20))
    cw,ch=box[2]-box[0],box[3]-box[1];scale=min(500/cw,420/ch);tw,th=round(cw*scale),round(ch*scale)
    board=Image.new('RGB',(2560,th+130),(23,27,34));draw=ImageDraw.Draw(board)
    draw.text((20,10),f"{v['name']} | fixed rigid camera, ONE scale; landmark RMS {v['landmark_rms_pixels']:.2f} px",font=font,fill='white')
    labels=['Reference photo','Before','After','Mask: cyan=missing/red=extra','RGB delta x2 (lighting-sensitive)']
    for i,(im,label) in enumerate(zip(images,labels)):
        draw.text((i*512+10,44),label,font=small,fill='white')
        board.paste(im.crop(box).resize((tw,th),Image.Resampling.LANCZOS),(i*512+10,72))
    draw.text((20,th+83),f"ROI mismatch {m['before']['mask_disagreement_pixels']:,} -> {m['after']['mask_disagreement_pixels']:,} px. Not manufacturer CAD or pixel-perfect certification.",font=small,fill='#bfc8d5')
    board.save(args.out/(v['name']+'.png'));rows.append(board)
(args.out/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
summary=Image.new('RGB',(2560,sum(im.height for im in rows)),(23,27,34));y=0
for im in rows:summary.paste(im,(0,y));y+=im.height
summary.resize((1920,round(summary.height*.75)),Image.Resampling.LANCZOS).save(args.out/'overview.jpg',quality=95)
print(json.dumps(metrics,indent=2))
