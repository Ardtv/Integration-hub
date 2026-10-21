require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const MarketplaceClient = require('./marketplace-client');

async function main() {
    console.log('════════ MARKETPLACE API TEST ════════');
    console.log('');

    const platforms = ['ozon', 'wb', 'kaspi'];

    for (const platform of platforms) {
        console.log(`▶ ${platform.toUpperCase()}`);

        const baseKey = `${platform.toUpperCase()}_API_BASE`;
        const apiKey = `${platform.toUpperCase()}_API_KEY`;

        const hasBase = !!process.env[baseKey];
        const hasKey = !!process.env[apiKey];

        console.log(`   ${baseKey}: ${hasBase ? '✅' : '❌'}`);
        console.log(`   ${apiKey}: ${hasKey ? '✅' : '❌'}`);

        if (hasBase && hasKey) {
            try {
                const client = new MarketplaceClient(platform);
                const ping = await client.ping();
                console.log(`   Ping: ${ping.ok ? '✅' : '❌'} ${JSON.stringify(ping)}`);
            } catch (e) {
                console.log(`   ❌ Ошибка: ${e.message}`);
            }
        }
        console.log('');
    }

    console.log('════════ DONE ════════');
}

main().catch(e => {
    console.error('❌ Fatal:', e);
    process.exit(1);
});
