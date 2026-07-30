import path from 'node:path';
export async function extractDocument({buffer,filename}){
  const ext=path.extname(filename).toLowerCase();
  if(ext==='.txt'||ext==='.md')return {text:buffer.toString('utf8'),pages:null};
  if(ext==='.pdf'){
    const pdfParse=(await import('pdf-parse')).default;
    const result=await pdfParse(buffer);
    const text=String(result.text??'').trim();
    if(text.length<80){const e=new Error('PDF appears scanned and requires OCR');e.code='OCR_REQUIRED';throw e;}
    return {text,pages:Number(result.numpages)||null};
  }
  if(ext==='.docx'){
    const mammoth=await import('mammoth');
    const result=await mammoth.extractRawText({buffer});
    return {text:String(result.value??'').trim(),pages:null};
  }
  const e=new Error('Unsupported document type');e.code='UNSUPPORTED_DOCUMENT_TYPE';throw e;
}
