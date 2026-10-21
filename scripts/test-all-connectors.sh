#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1

ENV=.env
PASS=0
FAIL=0
RUN=$(date +%s)

secret() { grep "^$1=" "$ENV" | cut -d= -f2; }
ok()     { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()    { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
psqlq()  { sudo -u postgres psql -d instinct_db -tAc "$1"; }
post()   { curl -s -m 15 -X POST "$1" -H "Content-Type: application/json" -d "$2"; }
code()   { curl -s -o /dev/null -m 10 -w "%{http_code}" -X POST "$1" -H "Content-Type: application/json" -d '{}'; }
wait_queue() {
    for i in $(seq 1 20); do
        local p; p=$(psqlq "SELECT COUNT(*) FROM integration_queue WHERE payload::text LIKE '%TEST-$RUN-%' AND status::text IN ('pending','processing')")
        [[ $p == 0 ]] && { echo "  ⏱ очередь разобрана за $((i*2)) с"; return; }
        sleep 2
    done
    echo "  ⏱ не разобрано за 40 с"
}


check() {
    local name=$1 port=$2 path=$3 secret_var=$4 marker=$5 body=$6
    local url="http://localhost:$port$path"
    echo "▶ $name (:$port)"

    local h; h=$(curl -s -m 5 "http://localhost:$port/health")
    if [[ $h == *'"ok"'* ]]; then ok "health"; else bad "health: ${h:-нет ответа}"; return; fi

    [[ $(code "$url") == 401 ]] && ok "без секрета → 401" || bad "без секрета не 401"

    local s; s=$(secret "$secret_var")
    local r1; r1=$(post "$url?secret=$s" "$body")
    [[ $r1 == *'"accepted"'* ]] && ok "событие принято hub" || bad "отправка: ${r1:0:200}"

    local r2; r2=$(post "$url?secret=$s" "$body")
    [[ $r2 == *'"duplicate"'* ]] && ok "повтор → duplicate" || bad "повтор не распознан: ${r2:0:200}"

    local n; n=$(psqlq "SELECT COUNT(*) FROM integration_queue WHERE payload::text LIKE '%$marker%'")
    [[ $n == 1 ]] && ok "в очереди 1 событие" || bad "в очереди $n событий"
}

echo "════════ TEST ALL CONNECTORS $(date '+%F %T') ════════"
echo "▶ hub (:3001)"
[[ $(curl -s -m 5 http://localhost:3001/health) == *'"ok"'* ]] && ok "health" || bad "hub не отвечает"

check "CDEK" 3003 /webhook/cdek CDEK_WEBHOOK_SECRET "TEST-$RUN-CDEK" "{\"type\":\"ORDER_STATUS\",\"uuid\":\"TEST-$RUN-CDEK\",\"attributes\":{\"code\":\"DELIVERED\",\"status_date_time\":\"t$RUN\"}}"
check "Fulfillment" 3004 /webhook/fulfillment FULFILLMENT_WEBHOOK_SECRET "TEST-$RUN-FF" "{\"shipment\":{\"id\":\"TEST-$RUN-FF\",\"status\":\"assembling\",\"updated_at\":\"t$RUN\"}}"
for p in ozon wb kaspi; do
    check "Marketplace/$p" 3005 /webhook/$p MARKETPLACE_WEBHOOK_SECRET "TEST-$RUN-$p" "{\"order\":{\"posting_number\":\"TEST-$RUN-$p\",\"status\":\"delivered\",\"updated_at\":\"t$RUN\"}}"
done
check "1С" 3006 /webhook/1c API_1C_WEBHOOK_SECRET "TEST-$RUN-1C" "{\"order\":{\"id\":\"TEST-$RUN-1C\",\"status\":\"paid\",\"sum\":100,\"version\":\"t$RUN\"}}"
check "МойСклад" 3007 /webhook/moysklad MOYSKLAD_WEBHOOK_SECRET "TEST-$RUN-MS" "{\"auditContext\":{\"moment\":\"t$RUN\"},\"events\":[{\"meta\":{\"type\":\"product\",\"href\":\"https://api.moysklad.ru/api/remap/1.2/entity/product/TEST-$RUN-MS\"},\"action\":\"UPDATE\",\"entity\":{\"id\":\"TEST-$RUN-MS\",\"name\":\"Тест\",\"salePrices\":[{\"value\":100}]}}]}"

echo "▶ обработка в hub"
wait_queue
psqlq "SELECT source || ' → ' || status FROM integration_queue WHERE payload::text LIKE '%TEST-$RUN-%' ORDER BY id" | sed 's/^/  /'
NP=$(psqlq "SELECT COUNT(*) FROM integration_queue WHERE payload::text LIKE '%TEST-$RUN-%' AND status::text <> 'processed'")
[[ $NP == 0 ]] && ok "все события processed" || bad "не обработано: $NP"

LEFT=$(psqlq "SELECT COUNT(*) FROM external_id_mapping WHERE external_id LIKE '%TEST-$RUN-%'")
[[ $LEFT == 0 ]] || echo "  ⚠️ hub создал записи в БД: $LEFT связей с TEST-$RUN- (проверить и удалить вручную)"

psqlq "DELETE FROM integration_queue WHERE payload::text LIKE '%TEST-$RUN-%'" > /dev/null
echo "════════ ИТОГ: ✅ $PASS  ❌ $FAIL ════════"
[[ $FAIL == 0 ]]
