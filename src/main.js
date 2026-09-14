import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';


/*
 * ============================================================
 * REVEL ORDER HISTORY ACTOR
 * ============================================================
 *
 * Purpose:
 *
 * 1. Log into Revel
 * 2. Select the requested establishment
 * 3. Set Order History date/time range
 * 4. Collect unique Order IDs
 * 5. Open each Order Detail page
 * 6. Extract order-level details
 * 7. Extract item-level details
 * 8. Extract modifiers
 * 9. Push final records to Apify Dataset
 *
 * ============================================================
 */


await Actor.init();


/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const BASE_URL =
    'https://laynes.revelup.com';

const ORDER_HISTORY_URL =
    `${BASE_URL}/reports/orders/`;


/*
 * Known Revel establishment labels.
 *
 * This gives us an extra layer of protection against
 * accidentally selecting the wrong location.
 */
const ESTABLISHMENTS = {
    leander: {
        name: 'Leander',
        number: '42',
        optionText: '42 | Leander',
    },

    lampasas: {
        name: 'Lampasas',
        number: '41',
        optionText: '41 | Lampasas',
    },
};


/*
 * ============================================================
 * INPUT
 * ============================================================
 */

const input =
    await Actor.getInput();

const {
    username,
    password,

    store = 'Leander',

    report_date,

    /*
     * These are optional for now.
     *
     * If your input_schema.json does not contain them yet,
     * these defaults will still be used.
     */
    start_time = '12:00 AM',
    end_time = '11:59 PM',

    max_concurrency = 5,
} = input ?? {};


/*
 * ============================================================
 * INPUT VALIDATION
 * ============================================================
 */

if (!username) {
    throw new Error(
        'Revel username is required.',
    );
}

if (!password) {
    throw new Error(
        'Revel password is required.',
    );
}

if (!report_date) {
    throw new Error(
        'report_date is required.',
    );
}


const normalizedStoreKey =
    String(store)
        .trim()
        .toLowerCase();

const establishmentConfig =
    ESTABLISHMENTS[
        normalizedStoreKey
    ];


if (!establishmentConfig) {
    throw new Error(
        `Unsupported establishment: "${store}". `
        + `Supported stores: `
        + `${Object.values(ESTABLISHMENTS)
            .map(x => x.name)
            .join(', ')}`,
    );
}


const targetStore =
    establishmentConfig.name;


/*
 * Concurrency guard.
 */
const orderConcurrency =
    Math.min(
        Math.max(
            Number(max_concurrency) || 5,
            1,
        ),
        10,
    );


console.log(
    '========================================',
);

console.log(
    'REVEL ORDER HISTORY ACTOR',
);

console.log(
    '========================================',
);

console.log(
    `Store: ${targetStore}`,
);

console.log(
    `Report date: ${report_date}`,
);

console.log(
    `Report range: `
    + `${start_time} → ${end_time}`,
);

console.log(
    `Maximum concurrency: `
    + `${orderConcurrency}`,
);

console.log(
    '========================================',
);


/*
 * Tracks whether the master request
 * actually completed successfully.
 */
let processingSucceeded =
    false;


/*
 * ============================================================
 * GENERIC HELPERS
 * ============================================================
 */

function clean(value) {

    if (
        value === null
        || value === undefined
    ) {
        return null;
    }

    const result =
        String(value)
            .replace(
                /\s+/g,
                ' ',
            )
            .trim();

    if (
        !result
        || result.toUpperCase() === 'N/A'
    ) {
        return null;
    }

    return result;
}


function escapeRegExp(value) {

    return String(value)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
        );
}


/*
 * ============================================================
 * LOGIN
 * ============================================================
 */

async function loginToRevel(page) {

    console.log(
        'Navigating to Revel...',
    );


    await page.goto(
        ORDER_HISTORY_URL,
        {
            waitUntil:
                'domcontentloaded',

            timeout:
                60_000,
        },
    );


    /*
     * If the establishment header exists,
     * the session is already authenticated.
     */
    const establishmentHeader =
        page.locator(
            '[data-cy="header-establishment-text"]',
        );


    const alreadyLoggedIn =
        await establishmentHeader
            .waitFor({
                state:
                    'visible',

                timeout:
                    5_000,
            })
            .then(
                () => true,
            )
            .catch(
                () => false,
            );


    if (alreadyLoggedIn) {

        console.log(
            'Existing authenticated Revel '
            + 'session detected.',
        );

        return;
    }


    console.log(
        'Logging into Revel...',
    );


    /*
     * --------------------------------------------------------
     * USERNAME
     * --------------------------------------------------------
     */

    const usernameField =
        page.locator(
            '#username',
        );


    await usernameField.waitFor({
        state:
            'visible',

        timeout:
            15_000,
    });


    await usernameField.fill(
        username,
    );


    console.log(
        'Username entered. '
        + 'Clicking Continue.',
    );


    const continueButton =
        page.getByRole(
            'button',
            {
                name:
                    'Continue',

                exact:
                    true,
            },
        );


    await continueButton.waitFor({
        state:
            'visible',

        timeout:
            15_000,
    });


    await continueButton.click();


    /*
     * --------------------------------------------------------
     * PASSWORD
     * --------------------------------------------------------
     */

    const passwordField =
        page.locator(
            'input[type="password"]',
        );


    await passwordField.waitFor({
        state:
            'visible',

        timeout:
            20_000,
    });


    console.log(
        'Password field appeared.',
    );


    await passwordField.fill(
        password,
    );


    /*
     * Revel's final submit control is not
     * consistently labeled "Login".
     *
     * This selector is proven against the
     * Layne's Revel tenant.
     */
    const loginButton =
        page.locator(
            'button[type="submit"]:visible, '
            + 'input[type="submit"]:visible',
        )
            .last();


    await loginButton.waitFor({
        state:
            'visible',

        timeout:
            15_000,
    });


    const buttonText =
        (
            await loginButton
                .textContent()
        )?.trim()
        ||
        (
            await loginButton
                .getAttribute(
                    'value',
                )
        )
        ||
        'Submit';


    console.log(
        `Clicking final login button: `
        + `${buttonText}`,
    );


    await loginButton.click();


    /*
     * Login is complete when the password
     * field disappears.
     */
    await passwordField.waitFor({
        state:
            'hidden',

        timeout:
            30_000,
    });


    await page.waitForLoadState(
        'domcontentloaded',
    );


    console.log(
        `Login completed. `
        + `Current URL: `
        + `${page.url()}`,
    );


    /*
     * Revel may redirect after login.
     */
    if (
        !page.url()
            .includes(
                '/reports/orders',
            )
    ) {

        console.log(
            'Navigating back to '
            + 'Order History...',
        );


        await page.goto(
            ORDER_HISTORY_URL,
            {
                waitUntil:
                    'domcontentloaded',

                timeout:
                    60_000,
            },
        );
    }


    /*
     * Final authentication validation.
     */
    await establishmentHeader.waitFor({
        state:
            'visible',

        timeout:
            30_000,
    });


    const currentEstablishment =
        clean(
            await establishmentHeader
                .textContent(),
        );


    console.log(
        `Revel login verified. `
        + `Current establishment: `
        + `${currentEstablishment}`,
    );
}


/*
 * ============================================================
 * ESTABLISHMENT SELECTION
 * ============================================================
 */

async function selectEstablishment(
    page,
    requestedStore,
) {

    console.log(
        `Checking establishment: `
        + `${requestedStore}`,
    );


    const establishmentText =
        page.locator(
            '[data-cy="header-establishment-text"]',
        );


    await establishmentText.waitFor({
        state:
            'visible',

        timeout:
            30_000,
    });


    const currentEstablishment =
        clean(
            await establishmentText
                .textContent(),
        );


    console.log(
        `Current establishment `
        + `before selection: `
        + `${currentEstablishment}`,
    );


    /*
     * Already correct.
     */
    if (
        currentEstablishment
            ?.toLowerCase()
        ===
        requestedStore
            .toLowerCase()
    ) {

        console.log(
            `Correct establishment `
            + `already selected: `
            + `${currentEstablishment}`,
        );

        return;
    }


    /*
     * --------------------------------------------------------
     * OPEN ESTABLISHMENT SELECTOR
     * --------------------------------------------------------
     */

    console.log(
        'Opening establishment selector...',
    );


    await establishmentText.click();


    /*
     * Revel sometimes keeps hidden FancyTree
     * copies in the DOM.
     *
     * Restrict all operations to the visible tree.
     */
    const establishmentTree =
        page.locator(
            'ul.fancytree-container:visible',
        )
            .first();


    await establishmentTree.waitFor({
        state:
            'visible',

        timeout:
            30_000,
    });


    console.log(
        'Establishment panel opened.',
    );


    /*
     * --------------------------------------------------------
     * SORT BY ESTABLISHMENT NUMBER
     * --------------------------------------------------------
     */

    const estabNumberButton =
        page.locator(
            'div.btn.by-id:visible',
        )
            .filter({
                hasText:
                    'Estab. No.',
            })
            .first();


    if (
        await estabNumberButton
            .isVisible()
            .catch(
                () => false,
            )
    ) {

        console.log(
            'Clicking "Estab. No." sort.',
        );


        await estabNumberButton.click();


        await page.waitForTimeout(
            500,
        );
    }


    /*
     * --------------------------------------------------------
     * EXPAND ALL
     * --------------------------------------------------------
     */

    const expandAll =
        page.locator(
            'span.expand-all:visible',
        )
            .first();


    if (
        await expandAll
            .isVisible()
            .catch(
                () => false,
            )
    ) {

        console.log(
            'Clicking "expand all"...',
        );


        await expandAll.click();


        await page.waitForTimeout(
            1500,
        );
    }


    /*
     * --------------------------------------------------------
     * FIND TARGET STORE
     * --------------------------------------------------------
     */

    const escapedStore =
        escapeRegExp(
            requestedStore,
        );


    const establishmentPattern =
        new RegExp(
            `(?:^|\\|\\s*)`
            + `${escapedStore}`
            + `\\s*$`,

            'i',
        );


    const targetOptions =
        establishmentTree
            .locator(
                'span.fancytree-title:visible',
            )
            .filter({
                hasText:
                    establishmentPattern,
            });


    const visibleMatchCount =
        await targetOptions.count();


    console.log(
        `Visible matching establishment `
        + `options found: `
        + `${visibleMatchCount}`,
    );


    if (
        visibleMatchCount === 0
    ) {

        throw new Error(
            `Could not find visible `
            + `establishment `
            + `"${requestedStore}".`,
        );
    }


    /*
     * Prefer exact establishment number + name
     * when available.
     */
    const exactOption =
        establishmentTree
            .locator(
                'span.fancytree-title:visible',
            )
            .filter({
                hasText:
                    new RegExp(
                        `^\\s*`
                        + `${escapeRegExp(
                            establishmentConfig
                                .optionText,
                        )}`
                        + `\\s*$`,

                        'i',
                    ),
            })
            .first();


    const exactVisible =
        await exactOption
            .isVisible()
            .catch(
                () => false,
            );


    const targetOption =
        exactVisible
            ? exactOption
            : targetOptions.first();


    await targetOption.waitFor({
        state:
            'visible',

        timeout:
            20_000,
    });


    const optionText =
        clean(
            await targetOption
                .textContent(),
        );


    console.log(
        `Selecting visible `
        + `establishment option: `
        + `${optionText}`,
    );


    await targetOption
        .scrollIntoViewIfNeeded();


    await targetOption.click();


    /*
     * --------------------------------------------------------
     * VERIFY HEADER
     * --------------------------------------------------------
     */

    const selectedHeader =
        page.locator(
            '[data-cy="header-establishment-text"]',
        )
            .filter({
                hasText:
                    new RegExp(
                        `^\\s*`
                        + `${escapedStore}`
                        + `\\s*$`,

                        'i',
                    ),
            });


    await selectedHeader.waitFor({
        state:
            'visible',

        timeout:
            30_000,
    });


    const selectedEstablishment =
        clean(
            await page
                .locator(
                    '[data-cy="header-establishment-text"]',
                )
                .textContent(),
        );


    console.log(
        `Establishment after selection: `
        + `${selectedEstablishment}`,
    );


    if (
        selectedEstablishment
            ?.toLowerCase()
        !==
        requestedStore
            .toLowerCase()
    ) {

        throw new Error(
            `ESTABLISHMENT VALIDATION FAILED. `
            + `Expected "${requestedStore}", `
            + `but Revel shows `
            + `"${selectedEstablishment}".`,
        );
    }


    console.log(
        `Establishment verified successfully: `
        + `${selectedEstablishment}`,
    );
}


/*
 * ============================================================
 * ORDER HISTORY DATE RANGE
 * ============================================================
 */

async function setReportDate(
    page,
    reportDate,
    startTime,
    endTime,
) {

    console.log(
        `Setting Order History date: `
        + `${reportDate}`,
    );


    /*
     * Open Revel's date-range picker.
     */
    const dateRangeDropdown =
        page.locator(
            '.report-date-row .ico-f-to-down',
        );


    await dateRangeDropdown.waitFor({
        state:
            'visible',

        timeout:
            20_000,
    });


    console.log(
        'Opening Order History '
        + 'date-range picker...',
    );


    await dateRangeDropdown.click();


    const visibleDatePicker =
        page.locator(
            '.daterangepicker:visible',
        );


    await visibleDatePicker.waitFor({
        state:
            'visible',

        timeout:
            20_000,
    });


    console.log(
        'Order History date-range '
        + 'picker opened.',
    );


    /*
     * --------------------------------------------------------
     * SET INTERNAL DATERANGEPICKER
     * --------------------------------------------------------
     */

    const pickerResult =
        await page.evaluate(
            ({
                requestedDate,
                requestedStartTime,
                requestedEndTime,
            }) => {

                const $ =
                    window.jQuery;

                const moment =
                    window.moment;


                if (!$) {

                    throw new Error(
                        'jQuery is not '
                        + 'available on Revel.',
                    );
                }


                if (!moment) {

                    throw new Error(
                        'Moment.js is not '
                        + 'available on Revel.',
                    );
                }


                /*
                 * Locate elements that own
                 * daterangepicker instances.
                 */
                const candidates =
                    $('*').filter(
                        function findPicker() {

                            return Boolean(
                                $(this)
                                    .data(
                                        'daterangepicker',
                                    ),
                            );
                        },
                    );


                if (
                    candidates.length
                    === 0
                ) {

                    throw new Error(
                        'Unable to locate Revel '
                        + 'daterangepicker.',
                    );
                }


                /*
                 * Prefer the currently visible picker.
                 */
                let picker =
                    null;


                candidates.each(
                    function selectVisiblePicker() {

                        const candidate =
                            $(this)
                                .data(
                                    'daterangepicker',
                                );


                        if (
                            !picker
                            &&
                            candidate?.container
                            &&
                            candidate
                                .container
                                .is(
                                    ':visible',
                                )
                        ) {

                            picker =
                                candidate;
                        }
                    },
                );


                if (!picker) {

                    picker =
                        $(candidates[0])
                            .data(
                                'daterangepicker',
                            );
                }


                /*
                 * Build explicit start/end date-times.
                 */
                const startDateTime =
                    moment(
                        `${requestedDate} `
                        + `${requestedStartTime}`,

                        'MM/DD/YYYY hh:mm A',

                        true,
                    );


                const endDateTime =
                    moment(
                        `${requestedDate} `
                        + `${requestedEndTime}`,

                        'MM/DD/YYYY hh:mm A',

                        true,
                    );


                if (
                    !startDateTime
                        .isValid()
                ) {

                    throw new Error(
                        `Invalid start date/time: `
                        + `${requestedDate} `
                        + `${requestedStartTime}`,
                    );
                }


                if (
                    !endDateTime
                        .isValid()
                ) {

                    throw new Error(
                        `Invalid end date/time: `
                        + `${requestedDate} `
                        + `${requestedEndTime}`,
                    );
                }


                if (
                    !endDateTime
                        .isAfter(
                            startDateTime,
                        )
                ) {

                    throw new Error(
                        'Order History end time '
                        + 'must be after start time. '
                        + `Received `
                        + `${startDateTime.format(
                            'MM/DD/YYYY hh:mm A',
                        )} through `
                        + `${endDateTime.format(
                            'MM/DD/YYYY hh:mm A',
                        )}.`,
                    );
                }


                if (
                    typeof picker
                        .setStartDate
                    !== 'function'
                    ||
                    typeof picker
                        .setEndDate
                    !== 'function'
                ) {

                    throw new Error(
                        'Revel daterangepicker '
                        + 'does not expose '
                        + 'setStartDate/setEndDate.',
                    );
                }


                picker.setStartDate(
                    startDateTime,
                );


                picker.setEndDate(
                    endDateTime,
                );


                if (
                    typeof picker
                        .updateView
                    === 'function'
                ) {

                    picker.updateView();
                }


                if (
                    typeof picker
                        .updateCalendars
                    === 'function'
                ) {

                    picker.updateCalendars();
                }


                if (
                    typeof picker
                        .updateFormInputs
                    === 'function'
                ) {

                    picker.updateFormInputs();
                }


                return {
                    startDate:
                        picker
                            .startDate
                            .format(
                                'MM/DD/YYYY hh:mm A',
                            ),

                    endDate:
                        picker
                            .endDate
                            .format(
                                'MM/DD/YYYY hh:mm A',
                            ),

                    hasClickApply:
                        typeof picker
                            .clickApply
                        === 'function',
                };
            },

            {
                requestedDate:
                    reportDate,

                requestedStartTime:
                    startTime,

                requestedEndTime:
                    endTime,
            },
        );


    console.log(
        `Internal Order History range: `
        + `${pickerResult.startDate} `
        + `through `
        + `${pickerResult.endDate}`,
    );


    if (
        !pickerResult.hasClickApply
    ) {

        throw new Error(
            'Revel daterangepicker '
            + 'does not expose '
            + 'clickApply().',
        );
    }


    /*
     * --------------------------------------------------------
     * APPLY DATE RANGE
     * --------------------------------------------------------
     */

    console.log(
        'Applying Order History '
        + 'date range...',
    );


    await page.evaluate(
        () => {

            const $ =
                window.jQuery;


            if (!$) {

                throw new Error(
                    'jQuery is not available '
                    + 'during Apply.',
                );
            }


            const candidates =
                $('*').filter(
                    function findPicker() {

                        return Boolean(
                            $(this)
                                .data(
                                    'daterangepicker',
                                ),
                        );
                    },
                );


            let picker =
                null;


            candidates.each(
                function selectVisiblePicker() {

                    const candidate =
                        $(this)
                            .data(
                                'daterangepicker',
                            );


                    if (
                        !picker
                        &&
                        candidate?.container
                        &&
                        candidate
                            .container
                            .is(
                                ':visible',
                            )
                    ) {

                        picker =
                            candidate;
                    }
                },
            );


            if (
                !picker
                &&
                candidates.length > 0
            ) {

                picker =
                    $(candidates[0])
                        .data(
                            'daterangepicker',
                        );
            }


            if (!picker) {

                throw new Error(
                    'Unable to locate '
                    + 'daterangepicker '
                    + 'during Apply.',
                );
            }


            if (
                typeof picker
                    .clickApply
                !== 'function'
            ) {

                throw new Error(
                    'Revel daterangepicker '
                    + 'does not expose '
                    + 'clickApply().',
                );
            }


            picker.clickApply();
        },
    );


    await visibleDatePicker.waitFor({
        state:
            'hidden',

        timeout:
            30_000,
    });


    console.log(
        'Date picker closed. '
        + 'Waiting for Order History '
        + 'to refresh...',
    );


    /*
     * Validate that the visible date row
     * now contains the requested date.
     */
    await page.waitForFunction(
        ({
            expectedDate,
        }) => {

            const normalizeDate =
                (value) => {

                    const match =
                        String(value)
                            .match(
                                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                            );


                    if (!match) {
                        return null;
                    }


                    const [
                        ,
                        month,
                        day,
                        year,
                    ] = match;


                    return (
                        `${month.padStart(
                            2,
                            '0',
                        )}/`
                        + `${day.padStart(
                            2,
                            '0',
                        )}/`
                        + `${year}`
                    );
                };


            const reportDateRow =
                document
                    .querySelector(
                        '.report-date-row',
                    );


            if (!reportDateRow) {
                return false;
            }


            const displayedDates =
                (
                    reportDateRow
                        .textContent
                    ?? ''
                )
                    .match(
                        /\d{1,2}\/\d{1,2}\/\d{4}/g,
                    )
                    ?.map(
                        normalizeDate,
                    );


            if (
                !displayedDates
                ||
                displayedDates.length
                === 0
            ) {

                return false;
            }


            const expected =
                normalizeDate(
                    expectedDate,
                );


            return displayedDates
                .every(
                    date =>
                        date === expected,
                );
        },

        {
            expectedDate:
                reportDate,
        },

        {
            timeout:
                90_000,

            polling:
                500,
        },
    );


    /*
     * Give the underlying AJAX/table refresh
     * a little opportunity to begin rendering.
     */
    await page.waitForTimeout(
        1000,
    );


    console.log(
        `Order History date applied `
        + `successfully: `
        + `${reportDate}`,
    );
}


/*
 * ============================================================
 * COLLECT ORDER IDs
 * ============================================================
 */

async function collectOrderIds(
    page,
) {

    console.log(
        'Collecting Order IDs...',
    );


    const orderLinks =
        page.locator(
            'a[href*="/reports/orders/"]',
        );


    /*
     * Order History refreshes asynchronously.
     *
     * Do not count immediately after Apply.
     */
    try {

        await orderLinks
            .first()
            .waitFor({
                state:
                    'visible',

                timeout:
                    60_000,
            });

    } catch {

        console.warn(
            'No Order History links '
            + 'became visible within '
            + '60 seconds.',
        );
    }


    /*
     * Capture all qualifying links,
     * visible or otherwise.
     */
    const rawOrders =
        await page
            .locator(
                'a[href*="/reports/orders/"]',
            )
            .evaluateAll(
                links => {

                    return links
                        .map(
                            link => {

                                const href =
                                    link.href
                                    ?? '';


                                const match =
                                    href.match(
                                        /\/reports\/orders\/(\d+)\/?/,
                                    );


                                if (!match) {
                                    return null;
                                }


                                return {
                                    order_id:
                                        match[1],

                                    text:
                                        (
                                            link.textContent
                                            ?? ''
                                        )
                                            .trim(),

                                    url:
                                        href,
                                };
                            },
                        )
                        .filter(
                            Boolean,
                        );
                },
            );


    /*
     * Deduplicate by Revel Order ID.
     */
    const uniqueOrders =
        [
            ...new Map(
                rawOrders.map(
                    order => [
                        order.order_id,
                        order,
                    ],
                ),
            ).values(),
        ];


    console.log(
        `Raw matching links found: `
        + `${rawOrders.length}`,
    );


    console.log(
        `Unique Order IDs found: `
        + `${uniqueOrders.length}`,
    );


    if (
        uniqueOrders.length === 0
    ) {

        /*
         * Diagnostic information if the
         * page really has no records.
         */
        const bodyText =
            await page
                .locator(
                    'body',
                )
                .innerText()
                .catch(
                    () => '',
                );


        console.log(
            `Current URL: `
            + `${page.url()}`,
        );


        console.log(
            `Page reports no results: `
            + `${
                /no data|no results|no records/i
                    .test(
                        bodyText,
                    )
            }`,
        );


        throw new Error(
            'No Order IDs were found '
            + 'on the Order History page '
            + 'after waiting for '
            + 'the report refresh.',
        );
    }


    console.log(
        `First Order ID: `
        + `${uniqueOrders[0]
            .order_id}`,
    );


    console.log(
        `Last Order ID: `
        + `${
            uniqueOrders[
                uniqueOrders.length - 1
            ].order_id
        }`,
    );


    return uniqueOrders;
}


/*
 * ============================================================
 * ORDER DETAIL PARSER
 * ============================================================
 */

async function parseOrderPage(
    page,
    orderId,
) {

    return await page.evaluate(
        ({
            requestedOrderId,
        }) => {

            /*
             * ------------------------------------------------
             * INTERNAL CLEAN
             * ------------------------------------------------
             */

            const cleanValue =
                value => {

                    if (
                        value === null
                        ||
                        value === undefined
                    ) {

                        return null;
                    }


                    const cleaned =
                        String(value)
                            .replace(
                                /\s+/g,
                                ' ',
                            )
                            .trim();


                    if (
                        !cleaned
                        ||
                        cleaned
                            .toUpperCase()
                        === 'N/A'
                    ) {

                        return null;
                    }


                    return cleaned;
                };


            /*
             * ------------------------------------------------
             * DETAIL LABEL HELPER
             * ------------------------------------------------
             */

            const getDetail =
                (
                    container,
                    label,
                ) => {

                    const labels =
                        [
                            ...container
                                .querySelectorAll(
                                    '.horizontal_details .label',
                                ),
                        ];


                    const labelElement =
                        labels.find(
                            element =>
                                element
                                    .textContent
                                    .trim()
                                    .toLowerCase()
                                ===
                                label
                                    .toLowerCase(),
                        );


                    if (!labelElement) {
                        return null;
                    }


                    const li =
                        labelElement
                            .closest(
                                'li',
                            );


                    if (!li) {
                        return null;
                    }


                    const clone =
                        li.cloneNode(
                            true,
                        );


                    clone
                        .querySelector(
                            '.label',
                        )
                        ?.remove();


                    return cleanValue(
                        clone.textContent,
                    );
                };


            /*
             * ------------------------------------------------
             * GENERAL LABEL VALUE SEARCH
             * ------------------------------------------------
             */

            const getPageDetail =
                label => {

                    const labels =
                        [
                            ...document
                                .querySelectorAll(
                                    '.label',
                                ),
                        ];


                    const wanted =
                        label
                            .replace(
                                /:$/,
                                '',
                            )
                            .trim()
                            .toLowerCase();


                    for (
                        const labelElement
                        of labels
                    ) {

                        const text =
                            (
                                labelElement
                                    .textContent
                                ?? ''
                            )
                                .replace(
                                    /:$/,
                                    '',
                                )
                                .trim()
                                .toLowerCase();


                        if (
                            text !== wanted
                        ) {
                            continue;
                        }


                        const parent =
                            labelElement
                                .closest(
                                    'li, '
                                    + 'tr, '
                                    + 'div',
                                );


                        if (!parent) {
                            continue;
                        }


                        const clone =
                            parent.cloneNode(
                                true,
                            );


                        const clonedLabel =
                            clone
                                .querySelector(
                                    '.label',
                                );


                        clonedLabel
                            ?.remove();


                        const value =
                            cleanValue(
                                clone.textContent,
                            );


                        if (value) {
                            return value;
                        }
                    }


                    return null;
                };


            /*
             * ------------------------------------------------
             * FIND NUMERIC VALUE BY LABEL
             * ------------------------------------------------
             */

            const findTextValue =
                label => {

                    const normalizedLabel =
                        label
                            .toLowerCase();


                    const rows =
                        [
                            ...document
                                .querySelectorAll(
                                    'tr',
                                ),
                        ];


                    for (
                        const row
                        of rows
                    ) {

                        const cells =
                            [
                                ...row
                                    .querySelectorAll(
                                        'th, td',
                                    ),
                            ];


                        if (
                            cells.length < 2
                        ) {
                            continue;
                        }


                        const first =
                            (
                                cells[0]
                                    .textContent
                                ?? ''
                            )
                                .replace(
                                    /:$/,
                                    '',
                                )
                                .trim()
                                .toLowerCase();


                        if (
                            first
                            === normalizedLabel
                        ) {

                            return cleanValue(
                                cells[
                                    cells.length - 1
                                ]
                                    .textContent,
                            );
                        }
                    }


                    /*
                     * Fallback:
                     * inspect common label-like elements.
                     */
                    const elements =
                        [
                            ...document
                                .querySelectorAll(
                                    'dt, label, '
                                    + '.label',
                                ),
                        ];


                    for (
                        const element
                        of elements
                    ) {

                        const text =
                            (
                                element.textContent
                                ?? ''
                            )
                                .replace(
                                    /:$/,
                                    '',
                                )
                                .trim()
                                .toLowerCase();


                        if (
                            text
                            !== normalizedLabel
                        ) {
                            continue;
                        }


                        const next =
                            element
                                .nextElementSibling;


                        if (next) {

                            const value =
                                cleanValue(
                                    next.textContent,
                                );


                            if (value) {
                                return value;
                            }
                        }
                    }


                    return null;
                };


            /*
             * ------------------------------------------------
             * ITEM NUMBER TABLE
             * ------------------------------------------------
             */

            const getNumberTable =
                container => {

                    const table =
                        container
                            .querySelector(
                                'table.order_item_numbers',
                            );


                    if (!table) {
                        return {};
                    }


                    const rows =
                        [
                            ...table
                                .querySelectorAll(
                                    'tr',
                                ),
                        ];


                    if (
                        rows.length < 2
                    ) {

                        return {};
                    }


                    const headers =
                        [
                            ...rows[0]
                                .querySelectorAll(
                                    'th',
                                ),
                        ]
                            .map(
                                th =>
                                    cleanValue(
                                        th.textContent,
                                    ),
                            );


                    const values =
                        [
                            ...rows[1]
                                .querySelectorAll(
                                    'td',
                                ),
                        ]
                            .map(
                                td =>
                                    cleanValue(
                                        td.textContent,
                                    ),
                            );


                    return Object
                        .fromEntries(
                            headers.map(
                                (
                                    header,
                                    index,
                                ) => [

                                    header,

                                    values[
                                        index
                                    ]
                                    ?? null,
                                ],
                            ),
                        );
                };


            /*
             * ------------------------------------------------
             * MODIFIERS
             * ------------------------------------------------
             */

            const getModifiers =
                container => {

                    return [
                        ...container
                            .querySelectorAll(
                                'tr[id="order_item_parent_modifiers"]',
                            ),
                    ]
                        .map(
                            row => {

                                const cells =
                                    [
                                        ...row
                                            .querySelectorAll(
                                                'td',
                                            ),
                                    ]
                                        .map(
                                            td =>
                                                cleanValue(
                                                    td.textContent,
                                                ),
                                        );


                                return {
                                    modifier_name:
                                        cells[2]
                                        ?? null,

                                    modifier_cost:
                                        cells[5]
                                        ?? null,

                                    modifier_price:
                                        cells[6]
                                        ?? null,
                                };
                            },
                        );
                };


            /*
             * ------------------------------------------------
             * ITEMS
             * ------------------------------------------------
             */

            const itemContainers =
                [
                    ...document
                        .querySelectorAll(
                            'div.order_item.item',
                        ),
                ];


            const items =
                itemContainers
                    .map(
                        (
                            container,
                            index,
                        ) => {

                            const heading =
                                container
                                    .querySelector(
                                        '.order_history_item',
                                    );


                            const itemName =
                                cleanValue(
                                    heading
                                        ?.textContent
                                        .replace(
                                            /^\s*Added\s+Item\s*-\s*/i,
                                            '',
                                        ),
                                );


                            const numbers =
                                getNumberTable(
                                    container,
                                );


                            const modifiers =
                                getModifiers(
                                    container,
                                );


                            const price =
                                numbers[
                                    'Price'
                                ]
                                ?? null;


                            const quantity =
                                numbers[
                                    'Quantity'
                                ]
                                ?? null;


                            let extendedPrice =
                                null;


                            if (
                                price !== null
                                &&
                                quantity !== null
                                &&
                                !Number.isNaN(
                                    Number(price),
                                )
                                &&
                                !Number.isNaN(
                                    Number(quantity),
                                )
                            ) {

                                extendedPrice =
                                    Number(price)
                                    *
                                    Number(quantity);
                            }


                            return {
                                item_index:
                                    index + 1,

                                item_name:
                                    itemName,

                                created_by:
                                    getDetail(
                                        container,
                                        'Created by:',
                                    ),

                                created_date:
                                    getDetail(
                                        container,
                                        'Created date:',
                                    ),

                                dining_option:
                                    getDetail(
                                        container,
                                        'Dining Option:',
                                    ),

                                station:
                                    getDetail(
                                        container,
                                        'Station:',
                                    ),

                                establishment_no:
                                    getDetail(
                                        container,
                                        'Establishment #:',
                                    ),

                                printed:
                                    getDetail(
                                        container,
                                        'Printed:',
                                    ),

                                updated_by:
                                    getDetail(
                                        container,
                                        'Updated by:',
                                    ),

                                updated_date:
                                    getDetail(
                                        container,
                                        'Updated date:',
                                    ),

                                voided_by:
                                    getDetail(
                                        container,
                                        'Voided By:',
                                    ),

                                voided_date:
                                    getDetail(
                                        container,
                                        'Voided date:',
                                    ),

                                price,

                                cost:
                                    numbers[
                                        'Cost'
                                    ]
                                    ?? null,

                                quantity,

                                extended_price:
                                    extendedPrice,

                                weight:
                                    numbers[
                                        'Weight'
                                    ]
                                    ?? null,

                                tax_rate:
                                    numbers[
                                        'Tax Rate'
                                    ]
                                    ?? null,

                                tax_amount:
                                    numbers[
                                        'Tax Amount'
                                    ]
                                    ?? null,

                                crv_value:
                                    numbers[
                                        'CRV value'
                                    ]
                                    ?? null,

                                modifier_cost:
                                    numbers[
                                        'Modifier Cost'
                                    ]
                                    ?? null,

                                modifier_price:
                                    numbers[
                                        'Modifier Price'
                                    ]
                                    ?? null,

                                discount_total:
                                    numbers[
                                        'Discount Total'
                                    ]
                                    ?? null,

                                modifiers,
                            };
                        },
                    );


            /*
             * ------------------------------------------------
             * ORDER HEADING
             * ------------------------------------------------
             *
             * Example:
             *
             * Order 17274446 (98258c67)
             * Reporting No: 93558
             */

            const headingCandidates =
                [
                    ...document
                        .querySelectorAll(
                            'h1, h2, h3, '
                            + '.page-header, '
                            + '.order_history_item',
                        ),
                ];


            const orderHeading =
                headingCandidates
                    .map(
                        element =>
                            cleanValue(
                                element
                                    .textContent,
                            ),
                    )
                    .find(
                        text =>
                            text
                            &&
                            new RegExp(
                                `\\b${requestedOrderId}\\b`,
                            )
                                .test(
                                    text,
                                ),
                    )
                ??
                cleanValue(
                    document.title,
                );


            const fullBodyText =
                document.body
                    ?.innerText
                ?? '';


            const reportingMatch =
                fullBodyText.match(
                    /Reporting\s+No\.?\s*:?\s*(\d+)/i,
                );


            const shortIdMatch =
                orderHeading
                    ?.match(
                        /Order\s+\d+\s*\(([^)]+)\)/i,
                    );


            /*
             * ------------------------------------------------
             * RETURN ORDER
             * ------------------------------------------------
             */

            return {
                order_id:
                    requestedOrderId,

                revel_short_id:
                    shortIdMatch
                        ? shortIdMatch[1]
                        : null,

                reporting_no:
                    reportingMatch
                        ? reportingMatch[1]
                        : null,

                order_heading:
                    orderHeading,

                created_by:
                    getPageDetail(
                        'Created by',
                    ),

                establishment_no:
                    getPageDetail(
                        'Establishment #',
                    ),

                mode:
                    getPageDetail(
                        'Mode',
                    ),

                created_date:
                    getPageDetail(
                        'Created date',
                    ),

                updated_by:
                    getPageDetail(
                        'Updated by',
                    ),

                updated_date:
                    getPageDetail(
                        'Updated date',
                    ),

                dining_option:
                    getPageDetail(
                        'Dining Option',
                    ),

                created_at:
                    getPageDetail(
                        'Created At',
                    ),

                updated_at:
                    getPageDetail(
                        'Updated At',
                    ),

                subtotal:
                    findTextValue(
                        'subtotal',
                    ),

                service_fee:
                    findTextValue(
                        'service fee',
                    ),

                tax:
                    findTextValue(
                        'tax',
                    ),

                final_total:
                    findTextValue(
                        'final total',
                    ),

                remaining_due:
                    findTextValue(
                        'remaining due',
                    ),

                discount:
                    findTextValue(
                        'discount',
                    ),

                item_count:
                    items.length,

                items,
            };
        },

        {
            requestedOrderId:
                String(orderId),
        },
    );
}


/*
 * ============================================================
 * PROCESS SINGLE ORDER
 * ============================================================
 */

async function processOrder(
    browserContext,
    order,
) {

    const page =
        await browserContext
            .newPage();


    try {

        console.log(
            `Processing Order `
            + `${order.order_id}...`,
        );


        await page.goto(
            order.url,
            {
                waitUntil:
                    'domcontentloaded',

                timeout:
                    60_000,
            },
        );


        /*
         * Confirm this really looks like an
         * Order Detail page before parsing.
         */
        await page.waitForFunction(
            orderId => {

                return document.body
                    ?.innerText
                    ?.includes(
                        orderId,
                    );

            },

            String(
                order.order_id,
            ),

            {
                timeout:
                    30_000,
            },
        );


        const parsedOrder =
            await parseOrderPage(
                page,
                order.order_id,
            );


        const result = {
            status:
                'success',

            location:
                targetStore,

            report_date,

            report_start_time:
                start_time,

            report_end_time:
                end_time,

            source_url:
                order.url,

            extracted_at:
                new Date()
                    .toISOString(),

            ...parsedOrder,
        };


        /*
         * Push one record per order.
         *
         * Items remain nested inside the order.
         */
        await Actor.pushData(
            result,
        );


        console.log(
            `Order ${order.order_id} `
            + `completed. `
            + `Items: `
            + `${parsedOrder.item_count}`,
        );


        return {
            success:
                true,

            order_id:
                order.order_id,

            item_count:
                parsedOrder.item_count,
        };

    } catch (error) {

        console.error(
            `Order ${order.order_id} `
            + `failed: `
            + `${error.message}`,
        );


        return {
            success:
                false,

            order_id:
                order.order_id,

            url:
                order.url,

            error:
                error.message,
        };

    } finally {

        await page
            .close()
            .catch(
                () => {},
            );
    }
}


/*
 * ============================================================
 * CONTROLLED CONCURRENCY
 * ============================================================
 */

async function processOrders(
    browserContext,
    orders,
    concurrency,
) {

    console.log(
        `Processing `
        + `${orders.length} `
        + `orders with concurrency `
        + `${concurrency}...`,
    );


    const results =
        new Array(
            orders.length,
        );


    let nextIndex =
        0;


    async function worker(
        workerNumber,
    ) {

        while (true) {

            const index =
                nextIndex++;


            if (
                index >= orders.length
            ) {

                return;
            }


            const order =
                orders[index];


            console.log(
                `Worker ${workerNumber}: `
                + `${index + 1}/`
                + `${orders.length} `
                + `Order `
                + `${order.order_id}`,
            );


            results[index] =
                await processOrder(
                    browserContext,
                    order,
                );
        }
    }


    const workerCount =
        Math.min(
            concurrency,
            orders.length,
        );


    const workers =
        Array.from(
            {
                length:
                    workerCount,
            },

            (
                _,
                index,
            ) =>
                worker(
                    index + 1,
                ),
        );


    await Promise.all(
        workers,
    );


    return results;
}


/*
 * ============================================================
 * MASTER CRAWLER
 * ============================================================
 */

const crawler =
    new PlaywrightCrawler({

        /*
         * Only the master Order History page
         * is a Crawlee request.
         *
         * Order Detail pages are opened manually
         * inside the authenticated BrowserContext.
         */
        maxRequestsPerCrawl:
            1,

        maxRequestRetries:
            0,

        maxConcurrency:
            1,

        requestHandlerTimeoutSecs:
            3600,


        async requestHandler({
            page,
        }) {

            /*
             * ------------------------------------------------
             * LOGIN
             * ------------------------------------------------
             */

            await loginToRevel(
                page,
            );


            /*
             * ------------------------------------------------
             * ESTABLISHMENT
             * ------------------------------------------------
             */

            await selectEstablishment(
                page,
                targetStore,
            );


            /*
             * ------------------------------------------------
             * DATE RANGE
             * ------------------------------------------------
             */

            await setReportDate(
                page,
                report_date,
                start_time,
                end_time,
            );


            /*
             * ------------------------------------------------
             * ORDER IDS
             * ------------------------------------------------
             */

            const orders =
                await collectOrderIds(
                    page,
                );


            console.log(
                '========================================',
            );

            console.log(
                `ORDERS TO PROCESS: `
                + `${orders.length}`,
            );

            console.log(
                '========================================',
            );


            /*
             * ------------------------------------------------
             * AUTHENTICATED CONTEXT
             * ------------------------------------------------
             */

            const browserContext =
                page.context();


            /*
             * ------------------------------------------------
             * PROCESS ORDER DETAILS
             * ------------------------------------------------
             */

            const results =
                await processOrders(
                    browserContext,
                    orders,
                    orderConcurrency,
                );


            /*
             * ------------------------------------------------
             * RESULTS
             * ------------------------------------------------
             */

            const successful =
                results.filter(
                    result =>
                        result.success,
                );


            const failed =
                results.filter(
                    result =>
                        !result.success,
                );


            const totalItems =
                successful.reduce(
                    (
                        total,
                        result,
                    ) =>
                        total
                        +
                        (
                            result.item_count
                            ?? 0
                        ),

                    0,
                );


            console.log(
                '========================================',
            );

            console.log(
                'ORDER PROCESSING SUMMARY',
            );

            console.log(
                '========================================',
            );

            console.log(
                `Orders discovered: `
                + `${orders.length}`,
            );

            console.log(
                `Orders successful: `
                + `${successful.length}`,
            );

            console.log(
                `Orders failed: `
                + `${failed.length}`,
            );

            console.log(
                `Items extracted: `
                + `${totalItems}`,
            );

            console.log(
                '========================================',
            );


            /*
             * ------------------------------------------------
             * SAVE FAILED ORDERS
             * ------------------------------------------------
             */

            if (
                failed.length > 0
            ) {

                const store =
                    await Actor
                        .openKeyValueStore();


                await store.setValue(
                    'FAILED_ORDERS',
                    {
                        location:
                            targetStore,

                        report_date,

                        start_time,

                        end_time,

                        failed_count:
                            failed.length,

                        failed_orders:
                            failed,

                        created_at:
                            new Date()
                                .toISOString(),
                    },
                );


                console.warn(
                    `${failed.length} order(s) `
                    + `failed. Details saved `
                    + `to FAILED_ORDERS.`,
                );
            }


            /*
             * Master page completed.
             */
            processingSucceeded =
                true;


            console.log(
                'Revel Order History '
                + 'processing completed.',
            );
        },


        /*
         * ====================================================
         * MASTER REQUEST FAILURE
         * ====================================================
         */

        async failedRequestHandler(
            {
                page,
                request,
            },
            error,
        ) {

            console.error(
                'Revel Order History '
                + 'master request failed: '
                + `${error.message}`,
            );


            /*
             * Store diagnostic failure record.
             */
            await Actor.pushData({
                status:
                    'master_failed',

                location:
                    targetStore,

                report_date,

                start_time,

                end_time,

                url:
                    page
                        ? page.url()
                        : request.url,

                error:
                    error.message,

                timestamp:
                    new Date()
                        .toISOString(),
            });
        },
    });


/*
 * ============================================================
 * RUN
 * ============================================================
 */

try {

    await crawler.run([
        ORDER_HISTORY_URL,
    ]);


    /*
     * Crawlee's failedRequestHandler can execute
     * without crawler.run() throwing.
     *
     * Explicitly check whether our master handler
     * actually finished.
     */
    if (
        !processingSucceeded
    ) {

        throw new Error(
            'Revel Order History Actor '
            + 'did not complete successfully. '
            + 'Review the preceding error logs.',
        );
    }


    console.log(
        '========================================',
    );

    console.log(
        'REVEL ORDER HISTORY ACTOR SUCCESS',
    );

    console.log(
        '========================================',
    );


} catch (error) {

    console.error(
        'Revel Order History Actor failed.',
    );


    console.error(
        error?.stack
        ?? error?.message
        ?? error,
    );


    throw error;


} finally {

    await Actor.exit();
}