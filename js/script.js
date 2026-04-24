// DOM элементы
const forexBtn = document.getElementById('forexModeBtn');
const cryptoBtn = document.getElementById('cryptoModeBtn');
const forexPanel = document.getElementById('forexPanel');
const cryptoPanel = document.getElementById('cryptoPanel');

// Элементы крипто-калькулятора
const cryptoSymbolInput = document.getElementById('cryptoSymbol');
const cryptoBalanceInput = document.getElementById('cryptoBalance');
const cryptoStopLossInput = document.getElementById('cryptoStopLoss');
const livePriceSpan = document.getElementById('livePriceDisplay');
const refreshPriceBtn = document.getElementById('refreshPriceBtn');
const cryptoCalcBtn = document.getElementById('cryptoCalcBtn');
const cryptoResultBox = document.getElementById('cryptoResultBox');

// Переменная для хранения текущей цены
let currentCryptoPrice = null;

// ---- ПЕРЕКЛЮЧЕНИЕ ПАНЕЛЕЙ (FOREX / CRYPTO) ----
function setActiveMode(mode) {
    if (mode === 'forex') {
        forexBtn.classList.add('active');
        cryptoBtn.classList.remove('active');
        forexPanel.classList.remove('hidden');
        cryptoPanel.classList.add('hidden');
    } else {
        cryptoBtn.classList.add('active');
        forexBtn.classList.remove('active');
        cryptoPanel.classList.remove('hidden');
        forexPanel.classList.add('hidden');
    }
}

forexBtn.addEventListener('click', () => setActiveMode('forex'));
cryptoBtn.addEventListener('click', () => setActiveMode('crypto'));

// ---------- Функция получения цены с Binance (USDT пары) ----------
async function fetchCryptoPrice(symbol) {
    if (!symbol) return null;
    // Форматируем символ: убираем пробелы, переводим в верхний регистр, удостоверимся что заканчивается на USDT
    let cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol.endsWith('USDT')) {
        // Если пользователь ввел BTC, ETH и т.д. - добавим USDT для унификации
        cleanSymbol = cleanSymbol + 'USDT';
    }
    try {
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Pair not found');
        const data = await response.json();
        const price = parseFloat(data.price);
        if (isNaN(price)) throw new Error('Invalid price');
        return { price, symbol: cleanSymbol };
    } catch (error) {
        console.warn('Binance fetch error:', error);
        return null;
    }
}

// Обновление отображаемой цены
async function updateLivePrice() {
    let rawSymbol = cryptoSymbolInput.value.trim();
    if (!rawSymbol) {
        livePriceSpan.textContent = '❌ Введите пару';
        currentCryptoPrice = null;
        return;
    }
    livePriceSpan.textContent = '⏳ загрузка...';
    const result = await fetchCryptoPrice(rawSymbol);
    if (result && result.price) {
        currentCryptoPrice = result.price;
        livePriceSpan.textContent = `$ ${currentCryptoPrice.toFixed(2)}`;
        // Если пользователь не ввел стоп-лосс, можно подсказать
        if (cryptoStopLossInput.value === '') {
            // Не трогаем, просто показываем цену
        }
    } else {
        livePriceSpan.textContent = '⚠️ Ошибка пары';
        currentCryptoPrice = null;
    }
}

// Ручное обновление цены по кнопке
refreshPriceBtn.addEventListener('click', () => {
    updateLivePrice();
});

// Автоматическая загрузка цены при изменении символа (с debounce)
let debounceTimer;
cryptoSymbolInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        updateLivePrice();
    }, 600);
});

// ---- ГЛАВНЫЙ РАСЧЁТ КРИПТЫ (риск 1% от депозита, плечи пока базовые)---
// По ТЗ: "потеря от входа до стопа была не больше 1% от депозита"
// Формула: RiskAmount = Balance * 0.01
// Риск на единицу: |Entry - StopLoss|
// Количество монет = RiskAmount / |Entry - StopLoss|
// Примечание: если нужно с плечом: плечо увеличивает покупательную способность, но риск % считается от собственного капитала.
// Без плеча quantity = RiskAmount / riskPerCoin.
// Но в крипте часто используют USDT маржу — тогда quantity считаем так же.
// Добавим возможность учитывать кредитное плечо? По умолчанию — без плеча, но можно расширить.
// Сделаем чистую формулу с 1% риска: (Баланс × 0.01) / (Цена входа − СтопЛосс)
// Входная цена = текущая рыночная (которую мы получили с Binance). Стоп лосс задаёт пользователь.
// Если стоп-лосс выше цены (лонг), то разница положительная. Если шорт — по условию потери, но упростим: лонг.

function calculateCryptoPosition() {
    // Проверяем, что есть текущая цена
    if (currentCryptoPrice === null || isNaN(currentCryptoPrice)) {
        cryptoResultBox.textContent = '❌ Сначала обновите цену пары';
        cryptoResultBox.classList.add('result-error');
        cryptoResultBox.classList.remove('result-success');
        return;
    }

    const balance = parseFloat(cryptoBalanceInput.value);
    const stopLoss = parseFloat(cryptoStopLossInput.value);
    const entryPrice = currentCryptoPrice;

    if (isNaN(balance) || balance <= 0) {
        cryptoResultBox.textContent = '❌ Укажите корректный баланс > 0';
        cryptoResultBox.classList.add('result-error');
        return;
    }
    if (isNaN(stopLoss) || stopLoss <= 0) {
        cryptoResultBox.textContent = '❌ Введите цену стоп-лосса (число)';
        cryptoResultBox.classList.add('result-error');
        return;
    }
    if (stopLoss === entryPrice) {
        cryptoResultBox.textContent = '❌ StopLoss не может равняться Entry';
        cryptoResultBox.classList.add('result-error');
        return;
    }

    // Для LONG позиции: риск на монету = (Entry - StopLoss)
    let riskPerCoin = entryPrice - stopLoss;
    if (riskPerCoin <= 0) {
        // Если стоп выше цены входа — возможен шорт? Но в классике для long риск должен быть положительным.
        // Для шорта: riskPerCoin = stopLoss - entryPrice. Учитываем направление.
        // Поскольку большинство трейдеров лонгуют, покажем понятную ошибку.
        cryptoResultBox.textContent = '⚠️ Стоп-лосс должен быть ниже цены входа (для LONG)';
        cryptoResultBox.classList.add('result-error');
        return;
    }

    const riskAmount = balance * 0.01;   // 1% от депозита
    const quantity = riskAmount / riskPerCoin;

    if (quantity <= 0) {
        cryptoResultBox.textContent = '0';
        cryptoResultBox.classList.add('result-error');
        return;
    }

    // Форматируем вывод: до 8 знаков для мелких монет
    const formattedQty = quantity.toFixed(8);
    const symbolDisplay = cryptoSymbolInput.value.trim().toUpperCase() || 'COIN';

    cryptoResultBox.innerHTML = `${formattedQty} <span style="font-size:0.9rem;">${symbolDisplay}</span>`;
    cryptoResultBox.classList.add('result-success');
    cryptoResultBox.classList.remove('result-error');

    // Доп. информация: стоимость позиции и сумма риска в $
    const positionValue = quantity * entryPrice;
    const riskUsd = riskPerCoin * quantity;
    cryptoResultBox.title = `Размер позиции: ~$${positionValue.toFixed(2)} | Риск: $${riskUsd.toFixed(2)} (1%)`;
}

// Обработчик кнопки расчёта крипты
cryptoCalcBtn.addEventListener('click', () => {
    if (currentCryptoPrice === null) {
        // Попробуем сначала загрузить цену, потом рассчитать
        updateLivePrice().then(() => {
            // Небольшая задержка, чтобы currentCryptoPrice обновился
            setTimeout(() => {
                calculateCryptoPosition();
            }, 200);
        });
    } else {
        calculateCryptoPosition();
    }
});

// Автоматический расчёт при изменении баланса или стоп-лосса (опционально)
cryptoBalanceInput.addEventListener('input', () => {
    if (currentCryptoPrice) calculateCryptoPosition();
});
cryptoStopLossInput.addEventListener('input', () => {
    if (currentCryptoPrice) calculateCryptoPosition();
});

// При загрузке страницы: подгрузить дефолтную цену BTCUSDT
window.addEventListener('DOMContentLoaded', async () => {
    // Установим значения по умолчанию для криптопанели (баланс 1000 уже в value)
    await updateLivePrice();
    // Если есть стоп-лосс по умолчанию не ставим, чтобы пользователь ввёл сам.
    // Для демонстрации можно предложить пример stop loss ниже цены на 2-3%
    if (currentCryptoPrice && !cryptoStopLossInput.value) {
        const suggestedStop = (currentCryptoPrice * 0.97).toFixed(2);
        cryptoStopLossInput.placeholder = `Напр. ${suggestedStop}`;
    }
    // предзаполним forex поля для декора
    const forexBalance = document.getElementById('forexBalance');
    const forexEntry = document.getElementById('forexEntry');
    const forexStop = document.getElementById('forexStop');
    const forexStep = document.getElementById('forexStep');
    const forexPriceStep = document.getElementById('forexPriceStep');
    if (forexBalance) forexBalance.value = '10000';
    if (forexEntry) forexEntry.value = '1.1050';
    if (forexStop) forexStop.value = '1.1020';
    if (forexStep) forexStep.value = '0.0001';
    if (forexPriceStep) forexPriceStep.value = '1';
});

// Блокировка кнопки вычисления FOREX (пока в разработке)
const forexCalcButton = document.getElementById('forexCalcBtn');
if (forexCalcButton) {
    forexCalcButton.addEventListener('click', (e) => {
        e.preventDefault();
        const forexResult = document.getElementById('forexResultBox');
        if (forexResult) forexResult.textContent = '🚧 В разработке';
        setTimeout(() => {
            if (forexResult) forexResult.textContent = '—';
        }, 1200);
    });
}