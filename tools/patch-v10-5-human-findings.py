from pathlib import Path
p=Path('SuperAgent_V10_5_Reliability_Rewrite.js')
s=p.read_text(encoding='utf-8')

# 1) Clean date/time words out of timed purchase reminder titles.
old='''  const verbMatch=original.match(/(اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\\s+(.+)$/iu);\n  const title=verbMatch?`${verbMatch[1]} ${String(verbMatch[2]||\"\").trim()}`:`أجيب ${taskTail}`;'''
new='''  const verbMatch=original.match(/(اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\\s+(.+)$/iu);\n  let cleanTaskTail=String(verbMatch?.[2]||taskTail||\"\").trim();\n  cleanTaskTail=cleanTaskTail.replace(/^(?:(?:النهارده|النهاردة|اليوم|بكره|بكرة|غدا|بعد\\s+بكره|بعد\\s+بكرة)\\s+)?(?:(?:الساعة|الساعه)\\s*)?(?:1[0-2]|[1-9])(?:\\s*[:٫.]\\s*[0-5]?\\d|\\s*(?:ونص|و\\s*نص|وربع|و\\s*ربع|إلا\\s*ربع|الا\\s*ربع))?\\s*(?:صباح(?:ًا|ا)?|الصبح|صبح|الفجر|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء(?:ً|ا)?|المساء|بالليل|ليل)?\\s*/iu,\"\").trim();\n  const title=verbMatch?`${verbMatch[1]} ${cleanTaskTail||taskTail}`:`أجيب ${cleanTaskTail||taskTail}`;'''
if old not in s: raise SystemExit('timed title anchor missing')
s=s.replace(old,new,1)

# 2) Canonical shopping key: leading Arabic definite article should not make a duplicate item.
anchor='''async function addShoppingItems(env,chatId,titles){'''
helper='''function canonicalShoppingKeyV105(value){\n  let n=normalizeArabicLoose(String(value||\"\")).trim();\n  if(/^ال[ء-ي]/u.test(n))n=n.slice(2);\n  return n;\n}\n\n'''
if anchor not in s: raise SystemExit('shopping helper anchor missing')
s=s.replace(anchor,helper+anchor,1)
old2='''    const title=String(title0||\"\").trim().slice(0,180);const n=normalizeArabicLoose(title);if(!n)continue;'''
new2='''    const title=String(title0||\"\").trim().slice(0,180);const n=canonicalShoppingKeyV105(title);if(!n)continue;'''
if old2 not in s: raise SystemExit('shopping key anchor missing')
s=s.replace(old2,new2,1)

p.write_text(s,encoding='utf-8')
print('patched V10.5 human findings',len(p.read_bytes()))
