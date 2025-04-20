const WebSocket = require('ws');

// Connect to magicblock WebSocket
const ws = new WebSocket('wss://devnet.magicblock.app');

// The account address to subscribe to
const accountAddress = 'ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu';

const EXPECTED_MAGIC = 0x240ea1ea;

function parsePriceData(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    
    const magic = view.getUint32(0, true);
    if (magic !== EXPECTED_MAGIC) {
      return { error: `Invalid magic number: 0x${magic.toString(16)}` };
    }
    
    if (buffer.length < 81) {
      return { error: 'Buffer too small to contain price data' };
    }
    const priceBytes = buffer.slice(73, 81);
    const rawPrice = new DataView(priceBytes.buffer, priceBytes.byteOffset, priceBytes.byteLength).getBigInt64(0, true);
    const price = Number(rawPrice) / 100_000_000;
    
    let confidence = price * 0.01;

    // find timestamp from stream
    let publishTime = new Date();
    try {
      // Try offset 88
      const timestamp = view.getBigUint64(88, true);
      // Check if this looks like a timestamp
      const date = new Date(Number(timestamp / 1000n));
      if (date.getFullYear() >= 2020 && date.getFullYear() <= 2030) {
        publishTime = date;
      }
    } catch (e) {
      publishTime = new Date();
    }
    
    return {
      price: price,
      confidence: confidence,
      publishTime: publishTime.toISOString(),
      rawPrice: rawPrice.toString(),
      magic: `0x${magic.toString(16)}`
    };

  } catch (e) {
    return { error: e.message };
  }
}


ws.on('open', function open() {
  console.log('Connected to Solana devnet WebSocket');
  
  const subscribeMsg = {
    jsonrpc: '2.0',
    id: 1,
    method: 'accountSubscribe',
    params: [
      accountAddress,
      {
        encoding: 'base64',
        commitment: 'confirmed'
      }
    ]
  };
  
  console.log(`Subscribing to price feed account: ${accountAddress}`);
  ws.send(JSON.stringify(subscribeMsg));
});


let lastTimestamp = 0;


ws.on('message', function incoming(data) {
  try {
    const message = JSON.parse(data);
    
    if (message.result !== undefined) {
      console.log(`Successfully subscribed with subscription ID: ${message.result}`);
      return;
    }
    

    if (message.params !== undefined && message.params.result !== undefined) {
      const now = Date.now();

      if (now - lastTimestamp > 1000) {
        lastTimestamp = now;
        
        const base64Data = message.params.result.value.data[0];
        const slot = message.params.result.context.slot;
        
        console.log('\n-----------------------------------------');
        console.log(`Price Feed Update at Slot: ${slot}`);
        console.log('-----------------------------------------');
        
        const priceData = parsePriceData(base64Data);
        
        if (priceData.error) {
          console.log(`Error: ${priceData.error}`);
        } else {
          console.log(`Price: $${priceData.price.toFixed(2)} ±$${priceData.confidence.toFixed(2)}`);
          console.log(`Published: ${priceData.publishTime}`);

          console.log(`Raw Price: ${priceData.rawPrice}`);
          console.log(`Magic: ${priceData.magic}`);
        }
      }
    }
  } catch (e) {
    console.error('Error parsing message:', e);
    console.log('Raw message:', data.toString().substring(0, 200) + '...');
  }
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

ws.on('close', function close() {
  console.log('WebSocket connection closed');
});

process.on('SIGINT', function() {
  console.log('Closing WebSocket connection');
  ws.close();
  process.exit();
});

console.log('Connecting to WebSocket...');
