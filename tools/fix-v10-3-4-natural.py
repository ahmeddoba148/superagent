from pathlib import Path
p=Path('SuperAgent_V10_3_4_Atomic_Direct.js')
s=p.read_text()
start=s.find('function extractNaturalShoppingItemsV1034(raw){')
end=s.find('\nasync function restoreShoppingListSnapshotV1034(',start)
if start<0 or end<0: raise SystemExit('natural shopping parser not found')
new=r'''function extractNaturalShoppingItemsV1034(raw){
  const original=String(raw||"").replace(/[؟?!.,،؛;]+/gu," ").replace(/\s+/g," ").trim();
  const t=normalizeArabicLoose(original);
  if(!t)return null;
  // Explicit clock/recurrence = a real reminder, never a shopping shortcut.
  if(/(?:\b(?:الساعه|الساعة|صباح|مساء|الظهر|العصر|بالليل|الليل|كل\s+(?:يوم|اسبوع|أسبوع))\b|\d{1,2}:\d{2}|(?:بعد|قبل)\s+\d+\s*(?:دقيقه|دقيقة|دقايق|ساعه|ساعة))/u.test(t))return null;
  if(/(?:معلومه|معلومة|معلومات|خبر|اخبار|أخبار|سعر|اسعار|أسعار|رابط|لينك|صوره|صورة|كود|نتيجه|نتيجة)/u.test(t))return null;
  const m=original.match(/^(?:(?:النهارده|النهاردة|بكره|بكرة|غدا)\s+)?(?:ممكن\s+)?(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش|ما\s+تنسانيش)\s+)?(?:(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)?(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/iu);
  if(!m)return null;
  let tail=String(m[1]||"").trim();
  tail=tail.replace(/\s+(?:النهارده|النهاردة|بكره|بكرة|غدا)$/iu,"").replace(/\s+(?:من|في|فى)\s+(?:الهايبر|السوبر\s*ماركت|الماركت|كارفور)$/iu,"").trim();
  if(!tail)return null;
  const items=splitShoppingItems(tail).map(x=>String(x||"").trim()).filter(Boolean).slice(0,30);
  return items.length?items:null;
}
'''
s=s[:start]+new+s[end:]
p.write_text(s)
print('natural shopping preservation hotfix applied',len(p.read_bytes()))
