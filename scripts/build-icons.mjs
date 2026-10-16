// Two ideas converge on one terracotta conclusion. No raster dependency.
// Generate SVG and a multi-resolution Windows ICO from the same stroke geometry.
import { promises as fs } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const target = fileURLToPath(new URL('../app/ui/public/', import.meta.url));
const paths = [[[17,18],[31,18],[31,32],[45,32]], [[17,46],[31,46],[31,32]]];
const squares = [[12,13],[12,41],[40,27]];
const accent = [217,119,87]; // #D97757; the right-hand conclusion node.
const d = paths.map(points => points.map(([x,y],i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="13" fill="#101010"/><path d="${d}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${squares.map(([x,y],i)=>`<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${i===2?'#D97757':'#fff'}"/>`).join('')}</svg>\n`;
const table = Array.from({length:256}, (_,n) => { for(let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0; });
function crc(bytes) { let value=0xffffffff;for(const b of bytes)value=table[(value^b)&255]^(value>>>8);return(value^0xffffffff)>>>0; }
function chunk(type,data) { const tag=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([head,tag,data,tail]); }
function distance(x,y,a,b) { const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy); }
function png(size) {
  const data=Buffer.alloc(size*(size*4+1)),samples=4;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    let alpha=0,red=0,green=0,blue=0;
    for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++) {
      const u=(x+(sx+.5)/samples)*64/size,v=(y+(sy+.5)/samples)*64/size;
      const qx=Math.max(Math.abs(u-32)-17,0),qy=Math.max(Math.abs(v-32)-17,0);
      if(Math.hypot(qx,qy)>13)continue;
      alpha++;
      const square=squares.findIndex(([x,y]) => Math.hypot(Math.max(Math.abs(u-x-5)-3,0),Math.max(Math.abs(v-y-5)-3,0))<=2);
      const ink=square>=0 || paths.some(points=>points.slice(1).some((point,i)=>distance(u,v,points[i],point)<=2));
      const rgb=square===2?accent:ink?[255,255,255]:[16,16,16];
      red+=rgb[0];green+=rgb[1];blue+=rgb[2];
    }
    const i=y*(size*4+1)+1+x*4;
    data[i]=alpha?Math.round(red/alpha):0;data[i+1]=alpha?Math.round(green/alpha):0;data[i+2]=alpha?Math.round(blue/alpha):0;data[i+3]=Math.round(255*alpha/(samples*samples));
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
const sizes=[16,24,32,48,64,128,256],images=sizes.map(png),header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((size,i)=>{const p=6+i*16;header[p]=header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length;});
await fs.mkdir(target,{recursive:true});
await fs.writeFile(path.join(target,'logo.svg'),svg);
await fs.writeFile(path.join(target,'logo.ico'),Buffer.concat([header,...images]));
await fs.writeFile(path.join(target,'logo.png'),images.at(-1));
console.log('Generated original SVG, PNG and seven-size ICO.');
