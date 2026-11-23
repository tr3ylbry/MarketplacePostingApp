import { COLOR_ANCHORS, IMAGE_COMPARISON as policy, MARKER, ORIENTATION_CUE, ImageComparisonError } from "../../application/imageComparison";

function gridPixels(raw: Buffer, grid:{x:number;y:number;cell:number;columns:number;rows:number}) {
  let bits="", margin=128;
  for(let n=0;n<grid.columns*grid.rows;n++){
    const size=grid.cell-8,rgb=[0,0,0],x=grid.x+n%grid.columns*grid.cell+4,y=grid.y+Math.floor(n/grid.columns)*grid.cell+4;
    for(let j=y;j<y+size;j++)for(let i=x;i<x+size;i++)for(let c=0;c<3;c++)rgb[c]+=raw[(j*policy.width+i)*3+c]/(size*size);
    const level=(rgb[0]+rgb[1]+rgb[2])/3;
    margin=Math.min(margin,Math.abs(level-128));
    if(Math.max(...rgb)-Math.min(...rgb)>20)margin=0;
    bits+=level>=128?"1":"0";
  }
  return {bits,margin};
}
export const markerPixels=(raw:Buffer)=>gridPixels(raw,MARKER);
function anchorMeans(raw:Buffer){return COLOR_ANCHORS.map(a=>{
  const means=[0,0,0],pixels=(a.width-16)*(a.height-16);
  for(let y=a.y+8;y<a.y+a.height-8;y++)for(let x=a.x+8;x<a.x+a.width-8;x++)for(let c=0;c<3;c++)means[c]+=raw[(y*policy.width+x)*3+c]/pixels;
  return means;
});}
export function inspectReferencePixels(raw:Buffer){
  if(raw.length!==policy.width*policy.height*3)throw new ImageComparisonError("reference");
  const marker=markerPixels(raw),anchors=anchorMeans(raw),orientation=gridPixels(raw,ORIENTATION_CUE);
  if(!marker.bits.startsWith(MARKER.prefix)||marker.margin<policy.markerMargin||orientation.bits!==ORIENTATION_CUE.bits||orientation.margin<policy.markerMargin||anchors.some((a,i)=>a.some((v,c)=>Math.abs(v-COLOR_ANCHORS[i].rgb[c])>1)))throw new ImageComparisonError("reference");
}
export function visualMetrics(reference:Buffer,returned:Buffer,check:()=>void){
  const length=policy.width*policy.height*3;
  if(reference.length!==length||returned.length!==length)throw new ImageComparisonError("decode");
  let absolute=0,squared=0;
  const tiles=new Float64Array(120);
  for(let y=0;y<policy.height;y++){
    check();
    for(let x=0;x<policy.width;x++)for(let c=0;c<3;c++){
      const offset=(y*policy.width+x)*3+c,delta=Math.abs(reference[offset]-returned[offset]);
      absolute+=delta;squared+=delta*delta;tiles[Math.floor(y/50)*10+Math.floor(x/50)]+=delta/(50*50*3);
    }
  }
  const a=markerPixels(reference), b=markerPixels(returned), expected=anchorMeans(reference), actual=anchorMeans(returned);
  const orientation=gridPixels(returned,ORIENTATION_CUE);
  // Decisions use unrounded values; presentation must not round a failure down
  // to a passing boundary.
  return { orientationErrors:Array.from(ORIENTATION_CUE.bits).filter((v,i)=>v!==orientation.bits[i]).length,orientationMargin:orientation.margin,
    markerErrors:Array.from(a.bits).filter((v,i)=>v!==b.bits[i]).length,markerMargin:b.margin,mae:absolute/length,
    rmse:Math.sqrt(squared/length),tileMae:Math.max(...tiles),anchorDelta:Math.max(...expected.flatMap((a,i)=>a.map((v,c)=>Math.abs(v-actual[i][c])))) };
}
