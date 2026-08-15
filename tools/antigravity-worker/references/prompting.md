# Antigravity Worker — Prompt Rehberi ve Sicil

Bu dosya varsayım değil, ölçüm. Aynı worker oturumunda (`codexpp-patch`) iki
farklı brief üslubu denendi, sonuçlar bağımsız olarak doğrulandı.

## Deney

Görev: bir Electron `app.asar` dosyasına çapa tabanlı yama uygulayan Node
CLI'ı yazmak. Kaynak 267 MB, 8564 dosya, 402'si `unpacked` işaretli.

### Ölçüm 1 — brief üslubunun etkisi

| | Zayıf brief | Düzeltme turu |
|---|---|---|
| Üslup | dosya listesi + birebir çapa | hata kalıpları + numaralı kabul testi |
| Süre | 3 dk 53 sn | 12 dk 08 sn |
| Token | 269k | 560k |
| Sonuç | 5 dosya doğru, 3 hata | 3/3 hata giderildi |
| Doğrulama iddiası | abartılı | ham çıktılı |

Zayıf brief kötü değildi: dosya yolları, export şekilleri, birebir çapa metni,
kısıtlar hepsi vardı. Yine de üç hata çıktı. Fark, brief'in **ne isteneceğini**
anlatıp **neyin yanlış gidebileceğini** anlatmamasıydı.

### Ölçüm 2 — tek atış mı, parçalı mı

Aynı görev sıfırdan, iki ayrı temiz çalışma alanında, aynı bilgi miktarıyla.
Tek fark bilginin teslim biçimi. Sonuçlar bağımsız bir doğrulayıcıyla sınandı
(başlık kümesi eşitliği, yan artefakt bayt karşılaştırması, yıkıcı bayrak,
bozuk çapa, belirlilik, yorum yasağı).

İki tekrar yapıldı. İkincisinde kabul testine integrity ve yan artefakt
sadakati eklendi, ayrıca `--help` ve bilinmeyen argüman reddi brief'e kural
olarak kondu.

| | A: tek atış | B: dört parça |
|---|---|---|
| Süre (1. / 2. tekrar) | 6 dk 23 sn / 5 dk 25 sn | 11 dk 37 sn / 10 dk 51 sn |
| Tur | 1 | 4 |
| Token (2. tekrar) | 559k | 424k |
| Ağırlıklı puan (2. tekrar) | 94/100 | 95/100 |
| Satır | 379 | 282 |

**Parçalamak kaliteyi artırmadı** — iki tekrarda da fark ölçüm hatası
sınırında kaldı. Ama iki gerçek fark var:

- **Süre:** parçalı kol yaklaşık 2 kat yavaş.
- **Token:** parçalı kol %25–30 daha **ucuz**. Her adımın bağlamı dar
  olduğu için tek dev turdan az token yakıyor.

> Uyarı: `total_tokens` konuşma boyunca **kümülatiftir**. Adımları toplarsan
> maliyeti kat kat şişirirsin. Son adımın değerini al.

Parçalamanın asıl faydası **kurtarılabilirlik**: bir adım patlarsa o adımı
tekrar edersin, tüm görevi değil. Tek atışta bir hata bütün turu çöpe atar.
Primitifleri erken sınama imkânı da veriyor — B kolu `replaceOnce`'ı üç
senaryoyla test edip devam etti.

Karar kuralı: iş bir turda bitecek kadar tanımlıysa ve hız önemliyse tek atış.
Belirsizse, token bütçesi darsa ya da ara ürün gözden geçirilecekse parçala.

### Ölçüm 3 — ağırlıklı karne

İkinci tekrar, boyutlar önceliklendirilerek puanlandı. Referans, aynı görevin
elle yazılmış ve bağımsız doğrulanmış çözümü.

| Boyut | Ağırlık | A: tek atış | B: parçalı | Referans |
|---|---|---|---|---|
| Doğruluk / bütünlük | 30 | 30 | 30 | 27 |
| Güvenlik / yıkıcılık | 20 | 20 | 20 | 20 |
| Dayanıklılık | 15 | 15 | 15 | 15 |
| Çözüm yolu / sürdürülebilirlik | 15 | 9 | 10 | 15 |
| Kod kalitesi | 10 | 10 | 10 | 10 |
| Doğrulama dürüstlüğü | 10 | 10 | 10 | 10 |
| **Toplam** | 100 | **94** | **95** | **97** |

İki kol da güvenlik, dayanıklılık, kod kalitesi ve dürüstlükte tam puan aldı.
Ölü değişken yok, yıkıcı bayraklar güvenli, bozuk çapada duruyor, çıktı
belirli. **Ölçülen boyutta worker referansı yakalıyor.**

Kaybettiği tek yer ölçülmeyen boyut: her tekrarda farklı ama geçerli çözümler
çıktı — elle `Pickle` ile başlık kurma, asar iç modüllerini (`lib/disk`,
`lib/filesystem`) kullanma, `createPackageFromStreams`. Üçü de testleri geçti;
ilk ikisi kütüphane sürümü değiştiğinde sessizce kırılacaktı. Kabul testi doğru
yazıldığında çözümü dayatmaya gerek kalmıyor — ama **sürdürülebilirliği ölçmek
istiyorsan onu da kabul testine koy**, yoksa worker en kısa yolu seçer.

Not: worker iki kolda da referansın kaçırdığı bir şeyi yakaladı — başlıkta
kaydı olmayıp yan dizinde duran 3 dosyayı. Referans başlıktan yeniden kuruyordu,
worker kaynağı olduğu gibi kopyaladı. **"Kaynakta ne varsa o" mantığı
"kayıtta ne yazıyorsa o" mantığından daha sağlam.**

## Gözlenen hata kalıpları

### 1. Çevre bağlamını keşfetmiyor

Kaynağın yanı başında `app.asar.unpacked/` klasörü duruyordu. Arşiv başlığında
8564 dosyanın 402'si `unpacked: true` işaretliydi — native modüller. Worker
`extractAll` + `createPackage` kullandı ve bu bayrakları düşürdü. Üretilen
asar sözdizimsel olarak geçerliydi ama uygulama sqlite'a ilk dokunduğunda
çökerdi.

Brief'te yazmıyordu, ama bakılacak yerdeydi. **Worker hedef dosyanın dışına
kendiliğinden bakmıyor.**

Karşı önlem: hedefin çevresindeki artefaktları isimle say. "Şunlara bak" de.

### 2. Yarım kalan niyet

`isCustomWorkDir` değişkenini hesapladı, hiçbir yerde kullanmadı. Sonuçta
`--work` ile verilen kullanıcı dizini `rmSync(recursive, force)` ile
siliniyordu. Değişkenin varlığı doğru düşündüğünü ama tamamlamadığını
gösteriyor.

Karşı önlem: "kullanmadığın değişken bırakma, kendi diff'ini oku" kuralını
brief'e yaz.

### 3. Doğrulamayı abartıyor

Raporunda "uçtan uca doğrulandı" yazdı. Gerçekte yaptığı, çıktı arşivinde bir
marker'ın geçtiğini kontrol etmekti. Ürettiği asar'ın **çalıştığını** hiç
denemedi. 1 numaralı hata tam bu boşluktan geçti.

Karşı önlem: kabul testlerini numarala, her biri için ham komut çıktısı iste,
"doğrulandı" demeyi açıkça yasakla.

### 4. Ölçüt belirsizse en ucuz formu seçiyor

Tur 2'de "başlıkları karşılaştır" dendi. Worker **sayı** karşılaştırdı
(402 = 402) ve geçti. Bağımsız kontrolde yol yol küme karşılaştırması
yapıldığında sonuç yine temiz çıktı — ama bu şans eseriydi, ölçüt bunu
garanti etmiyordu.

Karşı önlem: karşılaştırmanın **biçimini** yaz. "Kümeleri karşılaştır, simetrik
fark sayısını yazdır" gibi tek anlama gelen ölçüt ver.

## İyi yaptıkları

Aşırı kısıtlamaya değmez, kendi başına doğru şeyler de yapıyor:

- İstenmediği halde çıktıyı önce `.tmp-*` adına paketleyip sonra `rename`
  etti. Yarım yazılmış dosyanın hedefe düşmesini engelliyor.
- `.gitignore`'a `node_modules/` eklemesi kendiliğinden geldi.
- Mekanik kod kalitesi iyi: temiz fonksiyon ayrımı, tutarlı hata yolu.

Zayıf olduğu yer kod yazmak değil, **söylenmemiş bağlamı keşfetmek** ve
**kendi işini eleştirmek**.

## Brief şablonu

```
GOREV: <tek cümle>

ONCE OKU: <dosyalar>. Baglami oradan al.

BAGLAM: <neden bu is gerekiyor, hangi kisitlar var>
<hedefin cevresindeki artefaktlari isimle say>

KURULACAK DOSYALAR:
<yol + sorumluluk + varsa birebir export sekli>

KURALLAR:
- <basarisizlik davranisi: ne olursa dur, ne yazilmasin, cikis kodu>
- <salt-okunur kaynaklar, isimle>
- kullanmadigin degisken birakma
- <uslup: dil, yorum politikasi>

KABUL TESTI (bunlari calistirmadan bitti deme):
T1. <olcut, tek anlama gelecek bicimde>
T2. ...

RAPOR KURALI: Her test icin calistirdigin komutu ve GERCEK CIKTISINI yaz.
"dogrulandi" demek yeterli degil. Bir test gecmezse gecti diye yazma.
```

## Kabul testi yazarken

- Ölçüt sayılabilir olsun: "fark sayısı 0 olmalı", "çıkış kodu 0 dışı olmalı"
- Negatif test koy: bozuk girdide **durduğunu** ve yan etki bırakmadığını sına
- Yıkıcı yolları sına: silme/üzerine yazma davranışı olan her bayrak için
- Idempotansı sına: aynı işlem iki kez çalıştığında ne oluyor
- Temizlik iste: test artıkları silinsin

## Çalışma alanı izolasyonu

`agy` süreç cwd'sini **yok sayar**; kendi scratch dizininde başlar
(`~/.gemini/antigravity-cli/scratch`). Wrapper'daki `--cwd` tek başına
hiçbir şey izole etmiyordu; bir deneyde worker hedeflenen alanın dışına,
gerçek depoya yazdı ve bitmiş kodu bulup üzerine "sıfırdan yaptım" raporu
verdi. Deney tamamen geçersizdi.

Wrapper artık `--cwd` değerini `agy`'ye `--add-dir` olarak geçiriyor.

Ders: **worker'ın nerede çalıştığını varsayma, sor.** Yeni bir çalışma alanı
kurduğunda ilk iş `pwd` ve `ls` çalıştırıp doğrula. Bir karşılaştırma
deneyi yapıyorsan, referans çözümün worker'ın erişebileceği yerde
durmadığından emin ol.

## Süre ve maliyet

Tek turda 4–12 dakika, 250k–560k token bandında çalışıyor. `--print-timeout`
varsayılanı `45m`; ağır görevlerde `90m` verin. Görevi parçalara bölmek tek
seferde uzun timeout vermekten daha güvenilir — oturum context'i korunduğu için
bölmenin maliyeti düşük.
