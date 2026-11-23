import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { IMAGE_COMPARISON as policy, COLOR_ANCHORS, MARKER, ORIENTATION_CUE } from "../../application/imageComparison";
import { realMediaDigest } from "../../application/ebayRealMedia";

// Internal generated-only acceptance profile. No file/storage/provider I/O and
// no font/SVG renderer. Legacy manual capture fixture remains unchanged.
export async function generateVerificationFixture() {
  const bytes = verificationFixturePixels(randomBytes(16));
  try {
    const png = await sharp(bytes,{raw:{width:policy.width,height:policy.height,channels:3}}).png({compressionLevel:6,palette:false}).toBuffer();
    return { bytes:png,sourceDigest:realMediaDigest(png) };
  } finally { bytes.fill(0); }
}
// Pure raster construction also permits independently specified test vectors.
export function verificationFixturePixels(nonce: Uint8Array): Buffer {
  if (nonce.length !== 16) throw Error("Invalid generated fixture seed.");
  const raw=Buffer.alloc(policy.width*policy.height*3,245);
  const rect=(x:number,y:number,w:number,h:number,rgb:readonly number[])=>{
    for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)for(let c=0;c<3;c++)raw[(j*policy.width+i)*3+c]=rgb[c];
  };
  rect(20,125,460,100,[49,90,138]);
  // Asymmetric directional stair and moderate-frequency detail, no personal data.
  for(let n=0;n<12;n++)rect(28+n*15,140+n*5,12,10,[250,205,35]);
  for(let y=235;y<255;y+=4)for(let x=160;x<310;x+=8)rect(x,y,4,2,[30,35,40]);
  for(const a of COLOR_ANCHORS)rect(a.x,a.y,a.width,a.height,a.rgb);
  const bits=MARKER.prefix+Array.from(nonce,b=>b.toString(2).padStart(8,"0")).join("");
  rect(MARKER.x-8,MARKER.y-8,MARKER.columns*MARKER.cell+16,MARKER.rows*MARKER.cell+16,[255,255,255]);
  for(let i=0;i<bits.length;i++){
    const value=bits[i]==="1"?235:20;
    rect(MARKER.x+i%MARKER.columns*MARKER.cell,MARKER.y+Math.floor(i/MARKER.columns)*MARKER.cell,MARKER.cell,MARKER.cell,[value,value,value]);
  }
  rect(410,555,55,15,[80,45,130]);
  for(let i=0;i<ORIENTATION_CUE.bits.length;i++){
    const value=ORIENTATION_CUE.bits[i]==="1"?235:20;
    rect(ORIENTATION_CUE.x+i%3*12,ORIENTATION_CUE.y+Math.floor(i/3)*12,12,12,[value,value,value]);
  }
  return raw;
}
