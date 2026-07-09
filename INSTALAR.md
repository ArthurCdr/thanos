# BM Runner — instalação no macOS

Ferramenta local (roda na sua máquina, sem servidor na nuvem) para configurar
Business Managers da Meta em lote via AdsPower.

## Para o usuário final — 1 comando

Abra o **Terminal** (⌘+Espaço → "Terminal") e cole:

```bash
curl -fsSL https://raw.githubusercontent.com/ArthurCdr/thanos/main/instalar.sh | bash
```

Isso instala o Node (se faltar), baixa o app, instala tudo, cria um atalho
**"Abrir Painel BM"** na Área de Trabalho e abre o painel em
**http://localhost:4850**.

Depois é só:
1. Preencher a **Conexão AdsPower** (endereço da Local API + ID do perfil) e clicar **Testar conexão**.
2. Colar os **invites** e dados das BMs na fila.
3. Escolher a etapa e clicar **▶ Iniciar**.

> Pré-requisitos do lado do usuário: **AdsPower aberto** com a **Local API ligada**
> (Configurações → Local API), e o perfil já **logado na conta Meta**.

---

## Para você (o distribuidor) — publicar no GitHub

O one-liner acima precisa que o código esteja num repositório GitHub (é só
guarda-arquivo, não custa nada e o app continua rodando 100% local).

1. Crie um repositório no GitHub (público) — ex.: `bm-runner`.
2. Na pasta do projeto:
   ```bash
   git init && git add . && git commit -m "BM Runner"
   git branch -M main
   git remote add origin https://github.com/ArthurCdr/thanos.git
   git push -u origin main
   ```
3. Pronto — mande o one-liner pra quem quiser.

> `config.json`, `progress.json` e `relatorios/` estão no `.gitignore` — os dados
> de cada usuário ficam só na máquina dele e nunca vão pro GitHub.

## Alternativa sem GitHub (pasta/ZIP)

1. Zipe a pasta e mande (AirDrop/Drive).
2. O usuário descompacta e clica 2x em **`Abrir Painel.command`**
   (na 1ª vez, se faltar Node/deps, rode `bash instalar.sh` uma vez).
