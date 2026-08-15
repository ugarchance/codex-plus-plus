# Çalışma kuralları

## Minified bundle'da kod bulma

`webview/assets/app-initial-*.js` 14 MB, tek satır, isimleri küçültülmüş.
Burada `grep` ile deneme yanılma yapmak zaman kaybı. Genelden özele giden
sıra şu:

**1. Parser kur, gözle arama.** `acorn` + `acorn-walk` + `prettier` bir
kenara kurulur (`patch/` altına değil, geçici bir dizine). 14 MB dosya
acorn ile ~3 saniyede parse olur.

**2. Sabit bir dizeden başla.** Kullanıcıya görünen metin, React `key`
değeri, i18n id'si — bunlar minify edilmez. Örnek: `sign-in-openai`.
Dikkat: bu bundle'da dizeler **template literal** olarak yazılıyor, yani
AST'de `Literal` değil `TemplateElement` düğümü.

**3. Kapsayan fonksiyonu çıkar.** `walk.ancestor` ile atalar zincirini al,
en yakın fonksiyon düğümünün `[start, end]` aralığını dosyadan kes,
`prettier` ile biçimlendir, dosyaya yaz. Artık okunabilir 1000 satırlık
bir bileşen var.

**4. Veri akışını oku, tahmin etme.** Bu bundle React Compiler'dan geçmiş:
her değer `t[N]` memo yuvalarıyla sarılı ve blokların yarısı
`if (t[k] !== dep) { ... } else { ... }` biçiminde. Aranan şey:

- Değer hangi diziye/değişkene giriyor?
- O değişken **gerçekten render ediliyor mu**? `children:[...]` dizisine
  kadar takip et.
- Fonksiyonda **erken `return` var mı?** Bir bloğun çalışması render
  edildiği anlamına gelmez.

**5. Bağımlı tanımları da çıkar.** Bir isim (`Mcl`, `GV`, `KV`) tekrar
AST'den aranıp aynı yöntemle biçimlendirilir. Bileşenin prop sözleşmesi
destructuring satırından okunur.

**6. Çağrı yerlerini say.** Bir dal ölü mü canlı mı, ancak çağıranlara
bakınca anlaşılır. `sidebarFooter` sekiz yerde geçiyordu; tek anlamlı
çağrı yeri ölü dalın hangisi olduğunu söyledi.

Bu sıra izlenmezse ne oluyor: kod çalışıyor, log basıyor, diziye eleman
ekliyor — ama DOM'a hiçbir şey gelmiyor, çünkü o dizi kullanılmayan bir
dalda.

## Çapa yazma

Çapa **minified isme değil, anlama** dayanmalı. Sırasıyla tercih edilir:

1. Protokol sabiti / React key / i18n id
2. Prop destructuring imzası (`{accountIcon:X,accountLabel:Y,...}`)
3. Yapısal desen (belirli sırada 9 elemanlı `children` dizisi)

Minified isimler yamanın **çıktısı** olmalı, girdisi değil: desenden
yakalanıp enjeksiyona geri yazılır. `matchOnce` her deseni tam 1 eşleşmeye
zorlar; 0 veya 2 eşleşme yamanın sessizce yanlış yere gitmesi demektir.

Regex'te isim deseni `[A-Za-z_$][\w$]*` — `\w` `$` karakterini yakalamaz,
bu bundle'da `$5` gibi isimler var.

Genel dosyada değil, **pencerede** ara: çapa noktasını bulduktan sonra
`source.slice(index, index + N)` ile bileşenin gövdesine in, alt desenleri
orada `matchOnce` ile çöz. Aynı desen 14 MB içinde onlarca kez geçebilir.

## Doğrulama

Yama uygulandıktan sonra tek başına yeterli değil:

- `node --check` ile söz dizimi
- Uygulamayı `--remote-debugging-port` ile başlat, CDP üzerinden menüyü
  `Input.dispatchMouseEvent` ile aç (sentetik `.click()` React'te çalışmaz)
- DOM'dan gerçek metni oku, ekran görüntüsü al

`~/Library/Application Support/CodexPP/SingletonLock` bayat kalırsa
uygulama "Opening in existing browser session." deyip çıkar; kilit
dosyasının işaret ettiği pid yaşamıyorsa silinir.

## Sınırlar

- `/Applications/ChatGPT.app` salt okunur. Asla değiştirilmez.
- Token değerleri yazdırılmaz — sadece anahtar adı, hash, boolean karşılaştırma.
- GitHub'a push açık onay olmadan yapılmaz.
