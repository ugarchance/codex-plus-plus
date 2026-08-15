---
name: antigravity-worker
description: Delegate tasks and pair program with Antigravity as a stateful, persistent-context worker. Supports solo delegation (Codex + Antigravity) or trio collaboration (Codex + Claude via peer-sessions + Antigravity as the shared execution worker). Use whenever you want Antigravity to perform multi-step coding, research, file edits, testing, or tool workflows while keeping continuous chat history across multiple turns.
---

# Antigravity Worker

Antigravity (`agy`) provides a persistent, stateful worker agent that executes multi-step coding, codebase inspection, file modifications, and terminal test workflows with full tool access and automatic permissions (`--dangerously-skip-permissions`).

All worker sessions retain their **continuous chat context** across multiple turns via named sessions (`worker-main`, `worker-1`, `db-dev`, etc.).

---

## 🚦 Initial Workflow Setup: Choose Architecture

When this skill is invoked, if the user has not explicitly stated their preferred mode, **ask the user**:

> **"Antigravity Worker modunu nasıl kullanmak istersiniz?"**
> 1. **Doğrudan Worker Modu (Codex + Antigravity):** Codex doğrudan planlar ve görevleri worker olarak Antigravity'ye devredip yönetir.
> 2. **Trio Modu (Codex + Claude + Antigravity):** Codex ve Claude `peer-sessions` üzerinden mimari/planlama/review işbirliği yapar; ikisi de ağır kodlama ve test görevlerini Antigravity'ye devrederek ortak çalışır.

---

## Mode 1: Doğrudan Worker Modu (Codex + Antigravity)

Codex lider mimar olarak projeyi adımlara böler ve Antigravity worker oturumunu yönetir:

```bash
# 1. Adım: İlk görev ve analiz
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py send \
  --name worker-main \
  --prompt "Read the repository structure, analyze requirements in docs/ and outline the needed changes."

# 2. Adım: Kod yazımı (Aynı context ile devam eder)
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py send \
  --name worker-main \
  --prompt "Now write the core implementation in src/services/auth.ts based on your analysis."

# 3. Adım: Test ve doğrulama
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py send \
  --name worker-main \
  --prompt "Run npm test and fix any failing tests."
```

---

## Mode 2: Trio Modu (Codex + Claude + Antigravity)

Bu modda **Codex** (Lead Architect), **Claude** (Reviewer & Co-Architect) ve **Antigravity** (Execution Worker) birlikte çalışır:

1. **Claude Oturumunu Başlatma / Bağlanma:**
   - Codex, `peer-sessions` skill'i üzerinden Claude oturumunu kontrol eder (`peer-addr.py`) veya başlatır (`spawn-fleet.py`).
2. **Görev ve Mimari Paylaşımı:**
   - Codex ve Claude mimariyi tartışır, iş paketlerini belirler.
3. **Antigravity'ye Görev Dağıtımı:**
   - Hem Codex hem Claude, terminal komutu olarak `agy-session.py` çalıştırabilir:
     - **Ortak Hafıza:** İkisi de `--name worker-main` kullanarak aynı Antigravity oturumu üzerinden çalışabilir.
     - **Paralel Hafıza:** Codex `--name worker-backend`, Claude `--name worker-frontend` şeklinde iki ayrı özelleşmiş Antigravity worker'ı yönetebilir.
4. **Review & Refine Döngüsü:**
   - Antigravity işi bitirdiğinde Claude veya Codex çıktıyı inceler, gerekirse Antigravity oturumuna yeni düzeltme promptu gönderilir.

---

## CLI Komutları ve Kullanım Referansı

### 1. Mesaj Gönder / Sohbeti Sürdür
```bash
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py send \
  --name <session-name> \
  --prompt "<task description>" \
  [--json] \
  [--cwd <working-directory>] \
  [--add-dir <extra-directory>] \
  [--print-timeout <süre>] \
  [--mode {accept-edits,plan}] \
  [--model <model-name>] \
  [--effort {low,medium,high}]
```

- `--name` / `-n`: Oturum adı (varsayılan: `worker-1`). Aynı ad kullanıldığı sürece önceki tüm konuşma geçmişi (context) korunur.
- `--prompt` / `-p`: Worker'a verilecek görev metni.
- `--new`: Mevcut context'i sıfırlayıp bu isimle tertemiz yeni bir konuşma başlatır.
- `--json`: `response`, `conversation_id`, `num_turns`, `usage` gibi alanları JSON olarak döndürür.
- `--print-timeout`: Worker'a tanınan süre, varsayılan `45m`. `agy` kendi
  varsayılanı olan 5 dakikada uzun görevleri yarıda keser; script bu yüzden
  değeri açıkça geçiriyor. Ağır görevlerde `90m` verin.
- `--mode`: Varsayılan `accept-edits`. Bu olmadan worker dosya değişikliklerini
  uygulamayabilir. `plan` yalnızca planlatmak için.
- `--add-dir`: Çalışma dizini dışında erişilmesi gereken klasörler (tekrarlanabilir).

### Zaman aşımı davranışı

Süre dolarsa script hata döner ama **konuşma kaybolmaz** — aynı `--name` ile
tekrar `send` yaparak kaldığı yerden devam ettirebilirsiniz. Uzun işlerde
görevi baştan parçalara bölmek, tek seferde uzun timeout vermekten daha
güvenilir.

### 2. Aktif Oturumları Listele
```bash
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py list
```

### 3. Oturum Bilgisini Gör
```bash
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py show --name worker-main
```

### 4. Oturum Context'ini Sıfırla
```bash
python3 ~/.agents/skills/antigravity-worker/scripts/agy-session.py reset --name worker-main
```

---

## En İyi Pratikler

- **Takip Promptları Context Duyarlıdır:** *"Şimdi az önce yazdığın fonksiyonun testlerini ekle"* gibi kısa komutlar önceki turların tüm çıktısını bildiği için sorunsuz çalışır.
- **Otomatik Onay:** Script `--dangerously-skip-permissions` ile çalıştığı için kullanıcıdan ara onay istemez, görevleri özerk (autonomous) biçimde tamamlar.

---

## Prompt Rehberi

Worker mekanik kod yazmakta iyi. Zayıf olduğu iki yer var: **söylenmemiş
bağlamı keşfetmek** ve **kendi işini eleştirmek**. Brief bu ikisini
kapatmalı — "ne yapılacağını" anlatmak yetmiyor, "neyin yanlış gidebileceğini"
de yazmak gerekiyor.

Ölçülmüş fark (aynı görev, sıfırdan, izole çalışma alanı): sadece istenen
anlatıldığında 3 hata çıktı. Aşağıdaki maddeler eklenip görev **tek turda**
tekrar verildiğinde bağımsız kabul testlerinin tamamını geçti.

Aynı görev dört parçaya bölündüğünde kalite değişmedi (ağırlıklı karnede
94'e 95, ölçüm hatası sınırında). İki gerçek fark var: parçalı kol yaklaşık
**2 kat yavaş** ama **%25–30 daha ucuz** — her adımın bağlamı dar olduğu için.
**Parçalamak kaliteyi artırmıyor**; değeri kurtarılabilirlikte — bir adım
patlarsa tüm görevi değil o adımı tekrar edersin. İş bir turda bitecek kadar
tanımlıysa tek atış yeterli; belirsizse ya da ara ürün gözden geçirilecekse
parçala.

> `--json` çıktısındaki `total_tokens` konuşma boyunca **kümülatiftir**.
> Adımları toplarsan maliyeti kat kat şişirirsin. Son adımın değerini al.

### Brief'e mutlaka koyulacak altı şey

1. **Çevre bağlamı.** Hedef dosyanın yanındaki artefaktları isimle say. Worker
   kendiliğinden dışarı bakmıyor; yanı başında duran bir klasörü kaçırıyor.
2. **Başarısızlık davranışı.** Ne olursa dursun, hangi dosya yazılmasın, çıkış
   kodu ne olsun. Yarım çıktı en kötü sonuç.
3. **Salt-okunur kaynaklar.** Dokunulmayacak yolları açıkça yaz.
4. **Ölü kod yasağı.** "Kullanmadığın değişken bırakma." Yarım kalan niyet
   sık görülen hata: değişkeni hesaplayıp kullanmayı unutuyor.
5. **Numaralı kabul testi + ham çıktı zorunluluğu.** "Doğrulandı" demeyi
   açıkça yasakla, komut ve gerçek çıktı iste.
6. **Sürdürülebilirlik ölçütü.** Kabul testi sadece sonucu ölçüyorsa worker en
   kısa yolu seçer: belgelenmemiş iç modüllere bağlanır, ikili biçimi elle
   kurar. Kütüphanenin genel API'sinde kalması gerekiyorsa bunu ölçüt olarak
   yaz — üç ayrı koşuda üç farklı çözüm çıktı, hepsi testleri geçti, biri
   bir sonraki sürüm yükseltmesinde sessizce kırılacaktı.

### Ölçüt yazarken

Belirsiz bırakırsan en ucuz doğrulama biçimini seçer. "Karşılaştır" deme;
"kümeleri karşılaştır, simetrik fark sayısını yazdır" de. Ölçüt sayılabilir
olsun. Negatif test, idempotans testi ve yıkıcı bayrakların testini ayrıca
iste.

### Aşırı kısıtlama

Gerekmiyor. İstenmediği halde doğru şeyler de yapıyor (atomik yazma için
geçici dosya + rename gibi). Kalıbı dayat, çözümü değil.

Şablon, tam sicil ve gözlenen hata kalıpları:
[`references/prompting.md`](references/prompting.md)
