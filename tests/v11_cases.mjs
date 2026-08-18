// V11 pure regression cases used by the GitHub build and later staging certification.
export const V11_CASES = [
  {name:'identity',text:'انت اسمك اي',expected:'identity'},
  {name:'long-shopping',text:'بص عاوز اشتري\nعيش تورتيلا\nعيش توست\nفينو اسود\nفصوص رومي\nشيدر طبيعي\nكاجو\nفستق\nكوفي شيك\nحليب دينا\nايس كريم دينا\nوبطاطس طبيعية',expectedRoute:'easy',expectedItems:11},
  {name:'short-context-chain',text:'شيل الكبير وخلي اللي بعده قبل معاده بساعتين',expectedRoute:'complex'},
  {name:'plain-chat',text:'صباح الفل يا معلم',expectedRoute:'easy'},
  {name:'destructive',text:'امسح كل مواعيدي',expectedRoute:'complex'}
];
