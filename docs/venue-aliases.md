# Nomes históricos dos espaços

`venue` representa o espaço físico e o seu nome principal. `venue_alias` guarda nomes anteriores/alternativos. `gig`, `event` e `edition` mantêm o `venue_id` principal e podem guardar `venue_alias_id` para mostrar o nome associado ao registo.

Ao mudar o nome principal de um espaço, os registos que ainda usavam esse nome recebem a referência histórica antes da alteração. Acrescentar um nome alternativo não altera o nome dos concertos existentes. Não se inferem nomes históricos pela data.

A associação de dois espaços exige a mesma cidade e uma confirmação explícita de que representam o mesmo local físico. Os concertos, eventos e edições passam para o registo principal, mantendo os nomes originais. Os IDs dos concertos e dos eventos, presenças, favoritos, setlists e media não mudam. A operação é transacional e recusa concertos potencialmente duplicados que colidam com a chave artista/local/data; esses duplicados devem ser resolvidos primeiro.

`venue_redirect` conserva os IDs antigos dos espaços e aponta diretamente para o espaço principal e o nome histórico. Ao associar grupos que já têm redirecionamentos, as referências são atualizadas para evitar cadeias. Os links antigos continuam a abrir a ficha principal. As pesquisas por nomes anteriores não duplicam os resultados nem juntam espaços só por terem nomes iguais.

## Publicação

1. Aplicar a migração aditiva e repetível, antes de publicar a API:

   ```sh
   node scripts/migrate-venue-aliases.js --apply
   ```

2. Publicar a API e o frontend atualizados. A versão anterior não lê os redirecionamentos nem os nomes históricos; não associar os espaços antes de a nova API estar disponível.

3. Inspecionar o plano da associação (sem `--apply`, não há alterações):

   ```sh
   node scripts/merge-venues.js --source=127 --target=3129
   node scripts/merge-venues.js --source=1265 --target=3129
   ```

4. Aplicar as associações confirmadas, ou usar “Associar a outro espaço” na ficha do local, como administrador:

   ```sh
   node scripts/merge-venues.js --source=127 --target=3129 --apply
   node scripts/merge-venues.js --source=1265 --target=3129 --apply
   ```

O script guarda uma cópia dos registos afetados em `.secrets/` antes de cada associação. Pode escolher-se outro caminho com `--backup=/caminho/ficheiro.json`. Não se incluem estes ficheiros no Git.

Para o exemplo verificado, o destino é MEO Arena (3129). Pavilhão Atlântico (127) tem 47 concertos, 21 eventos e uma edição; Altice Arena (1265) não tem ligações. MEO Arena já tem cinco concertos e quatro eventos. Não foram encontradas colisões de concertos entre estes registos. “Pavilhão Atlântico (exterior)” (1162) é excluído desta associação.

A migração e as associações ficam preparadas no código; não foram executadas na base de dados de produção durante a implementação.
