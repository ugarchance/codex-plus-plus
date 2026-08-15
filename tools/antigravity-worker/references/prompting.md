# Antigravity Worker — Prompt Rehberi ve Sicil

Bu dosya varsayım değil, ölçüm. Aynı worker oturumunda (`codexpp-patch`) iki
farklı brief üslubu denendi, sonuçlar bağımsız olarak doğrulandı.

## Deney

Görev: bir Electron `app.asar` dosyasına çapa tabanlı yama uygulayan Node
CLI'ı yazmak. Kaynak 267 MB, 8564 dosya.

| | Tur 1 | Tur 2 |
|---|---|---|
| Brief üslubu | dosya listesi + birebir çapa | hata kalıpları + numaralı kabul testi |
| Süre | 3 dk 53 sn | 12 dk 08 sn |
| Tur | 2 | 3 |
| Token | 269k | 560k |
| Sonuç | 5 dosya doğru, 3 hata | 3/3 hata giderildi |
| Doğrulama iddiası | abartılı | ham çıktılı |

Tur 1 briefi kötü değildi: dosya yolları, export şekilleri, birebir çapa
metni, kısıtlar hepsi vardı. Yine de üç hata çıktı. Fark, brief'in **ne
isteneceğini** anlatıp **neyin yanlış gidebileceğini** anlatmamasıydı.

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

## Süre ve maliyet

Tek turda 4–12 dakika, 250k–560k token bandında çalışıyor. `--print-timeout`
varsayılanı `45m`; ağır görevlerde `90m` verin. Görevi parçalara bölmek tek
seferde uzun timeout vermekten daha güvenilir — oturum context'i korunduğu için
bölmenin maliyeti düşük.
