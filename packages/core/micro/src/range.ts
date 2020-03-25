/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    CalcObj,
    CalcValue,
    Pending,
    TypeMap,
    TypeName,
} from "@tiny-calc/nano";

import {
    errors,
    isPendingTask,
    makePendingFunction,
} from "./core";

import {
    CellValue,
    FunctionFiber,
    FunctionRunner,
    FunctionSkolem,
    PendingTask,
    Range,
    RangeContext,
    Reference,
} from "./types";

const makeCacheKey = (range: Range, prop: string) => `${prop};${range.tlRow};${range.tlCol};${range.height};${range.width}`;

const createRunner = <Accum, Res = Accum>(initAccum: (box: [Accum]) => (x: unknown) => void, finalise: (state: Accum) => Res) => {
    return (init: Accum) => {
        const result: FunctionRunner<Accum, Res> = [init, undefined!, finalise];
        result[1] = initAccum(result as unknown as [Accum]);
        return result as unknown as FunctionRunner<FunctionSkolem, Res>; // Pack the existential.
    };
};

export function runFunc<Res extends CellValue>(fiber: FunctionFiber<Res>) {
    const { context, runner, row, column, range } = fiber;
    const [, run, finish] = runner;
    const startCol = range.tlCol;
    const endR = range.tlRow + range.height;
    const endC = range.tlCol + range.width;

    /* Finish an incomplete row first. */
    for (let j = column; j < endC; j += 1) {
        const content = context.read(row, j);
        if (isPendingTask(content)) {
            fiber.column = j;
            return context.cache[makeCacheKey(range, fiber.state)] = { kind: "Pending" as const, fiber };
        }
        run(content);
    }
    for (let i = row + 1; i < endR; i += 1) {
        for (let j = startCol; j < endC; j += 1) {
            const content = context.read(i, j);
            if (isPendingTask(content)) {
                fiber.row = i;
                fiber.column = j;
                return context.cache[makeCacheKey(range, fiber.state)] = { kind: "Pending" as const, fiber };
            }
            run(content);
        }
    }
    return context.cache[makeCacheKey(range, fiber.state)] = finish(runner[0]);
}


const id: <X>(x: X) => X = x => x
const fromUndefined = (result: number | undefined) => result === undefined ? 0 : result

const createSum = createRunner<number>(result => n => { if (typeof n === "number") { result[0] += n; } }, id);
const createProduct = createRunner<number>(result => n => { if (typeof n === "number") { result[0] *= n; } }, id);
const createCount = createRunner<number>(result => n => { if (typeof n === "number") { result[0]++; } }, id);

function finishAverage(value: [number, number]): number | CalcObj<unknown> {
    const [total, finalCount] = value;
    return finalCount === 0 ? errors.div0 : total / finalCount;
}

const createAverage = createRunner(
    result => n => { if (typeof n === "number") { result[0][0] += n; result[0][1]++; } },
    finishAverage
);

const createMax = createRunner(
    result => n => {
        if (typeof n === "number" && (result[0] === undefined || n > result[0])) {
            result[0] = n;
        }
    },
    fromUndefined
);

const createMin = createRunner(
    result => n => {
        if (typeof n === "number" && (result[0] === undefined || n < result[0])) {
            result[0] = n;
        }
    },
    fromUndefined,
);

const createConcat = createRunner<string>((result) => s => { if (typeof s === "string") { result[0] += s; } }, id);

/*
 * Core aggregation functions over ranges
 */

type RangeAggregation<R> = (range: Range, context: RangeContext, someTask?: FunctionFiber<R>) => R | PendingTask<R>;

const rangeSum: RangeAggregation<number> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("sum", range, context, range.tlRow, range.tlCol, createSum(0)))

const rangeProduct: RangeAggregation<number> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("product", range, context, range.tlRow, range.tlCol, createProduct(1)));

const rangeCount: RangeAggregation<number> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("count", range, context, range.tlRow, range.tlCol, createCount(0)));

const rangeAverage: RangeAggregation<number | CalcObj<unknown>> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("average", range, context, range.tlRow, range.tlCol, createAverage([0, 0])));

const rangeMax: RangeAggregation<number> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("max", range, context, range.tlRow, range.tlCol, createMax(undefined)));

const rangeMin: RangeAggregation<number> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("min", range, context, range.tlRow, range.tlCol, createMin(undefined)));

const rangeConcat: RangeAggregation<string> = (range, context, someTask?) =>
    runFunc(someTask || makePendingFunction("concat", range, context, range.tlRow, range.tlCol, createConcat("")));

type FreshAggregation<R> = (range: Range, context: RangeContext) => R | PendingTask<R>;

const aggregations: Record<string, FreshAggregation<CellValue>> = {
    sum: rangeSum, product: rangeProduct, count: rangeCount, average: rangeAverage, max: rangeMax, min: rangeMin, concat: rangeConcat,
    SUM: rangeSum, PRODUCT: rangeProduct, COUNT: rangeCount, AVERAGE: rangeAverage, MAX: rangeMax, MIN: rangeMin, CONCAT: rangeConcat,
};

const serialiseRange = () => "REF";

const rangeTypeMap: TypeMap<Range, RangeContext> = {
    [TypeName.Readable]: {
        read: (receiver: Range, message: string, context: RangeContext): CalcValue<RangeContext> | Pending<CalcValue<RangeContext>> => {
            if (aggregations[message] !== undefined) {
                const key = makeCacheKey(receiver, message);
                const value = context.cache[key];
                if (value !== undefined) {
                    return value;
                }
                const fn = aggregations[message as keyof typeof aggregations];
                return fn(receiver, context);
            }
            switch (message) {
                case "row":
                case "ROW":
                    return receiver.tlRow + 1;
                case "column":
                case "COLUMN":
                    return receiver.tlCol + 1;
                default:
                    const value = context.read(receiver.tlRow, receiver.tlCol);
                    if (typeof value === "object") {
                        if (isPendingTask(value)) {
                            return value;
                        }
                        const reader = value.typeMap()[TypeName.Readable];
                        if (reader) {
                            return reader.read(value, message, context);
                        }
                    }
                    return errors.unknownField;

            }
        }
    },
    [TypeName.Reference]: {
        dereference: (value: Range, context: RangeContext) => context.read(value.tlRow, value.tlCol)
    }
}

const getRangeType = () => rangeTypeMap;

export const isRange = (v: { typeMap: () => unknown; }): v is Range => {
    return v.typeMap() === rangeTypeMap;
}

/**
 * A Range represents a view of the grid that knows how to calculate
 * aggregations over the view. The canonical value of a Range is the
 * top left corner.
 */
export function fromReference(reference: Reference): Range {
    const { row1, col1, row2, col2 } = reference;
    return row2 !== undefined && col2 !== undefined ?
        {
            tlRow: row1 < row2 ? row1 : row2,
            tlCol: col1 < col2 ? col1 : col2,
            height: Math.abs(row1 - row2) + 1,
            width: Math.abs(col1 - col2) + 1,
            serialise: serialiseRange,
            typeMap: getRangeType,
        } :
        {
            tlRow: row1,
            tlCol: col1,
            height: 1,
            width: 1,
            serialise: serialiseRange,
            typeMap: getRangeType,
        }
}
