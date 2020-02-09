/** Names of known types (traits) within the runtime */
export enum TypeName {
    Comparable,
    Error,
    Numeric,
    Readable,
    Reference,
}

/** An immutable map of known types */
export interface TypeMap<A, C> {
    readonly [TypeName.Comparable]?: ComparableType<A, C>;
    readonly [TypeName.Error]?: ErrorType<A, C>;
    readonly [TypeName.Numeric]?: NumericType<A, C>;
    readonly [TypeName.Readable]?: ReadableType<A, C>;
    readonly [TypeName.Reference]?: ReferenceType<A, C>;
}

export type Primitive = boolean | number | string;

export interface CalcObj<C> {
    /** 
     * An object's type map descibes the behaviours the object
     * supports. Type maps are immutable.
     *
     * The purpose of the `this` type is to allow authors to implement
     * types using more specific interfaces.
     *
     */
    typeMap(): TypeMap<this, C>;

    serialise(context: C): string;
}

/** A CalcObj that is known to implement types `T` */
export interface TypedCalcObj<T extends TypeName, C> {
    typeMap: () => Pick<Required<TypeMap<this, C>>, T>;
    serialise: (context: C) => string;
}

/** 
 * A CalcFun accepts two contexts:
 * - CLex is lexically scoped and active when the function is created.
 * - CDyn is dynamically scoped and active when the function is called.
 *
 * We do not capture the context (removing CDyn) because certain
 * functions want to maintain dynamic dependencies and linking them
 * against the lexical context would be wrong.
 *
 * The type constraints say that the dynamic context must be (at
 * least) as specific as the lexical context.
 *
 */
export interface CalcFun<CLex> {
    <CDyn extends CLex, Delay>(runtime: Runtime<Delay>, context: CDyn, args: CalcValue<CDyn>[]): CalcValue<CDyn> | Delay;
}

export type CalcValue<C> = Primitive | CalcObj<C> | CalcFun<C>;
export type DataValue<C> = Primitive | CalcObj<C>;

/** Dispatch pattern for a binary operator */
export enum DispatchPattern {
    /** Left operand has the type, right is primitive */
    L = -1,
    /** Right operand has the type, left is primitive */
    R = 1,
    /** Both operands have the correct type (which are equal up to pointer equality) */
    Both = 0,
}


export interface ComparableType<A, C> {
    /**
     * Compares two values.
     *
     * The compare function should follow the same comparator rules as
     * a JavaScript comparator, but may optionally return an object in
     * the event of error.
     *
     * 0 ~ GT, (<0) ~ LT, (>0) ~ GT.
     *
     * @param pattern
     * @param l
     * @param r
     * @param context
     */
    compare(pattern: DispatchPattern, l: A | Primitive, r: A | Primitive, context: C): number | CalcObj<C>;
}

export interface ErrorType<A, C> {
    /**
     * Error types support enriching with additional information which
     * they may choose to ignore.
     *
     * @param value
     * @param message
     * @param context
     */
    enrich(value: A, message: string, context: C): A;
}

/** 
 * Numeric operations that can be overloaded
 *
 * A numeric type should support operations with primitive numbers and
 * other objects of the same numeric type.
 */
export interface NumericType<A, C> {
    plus(pattern: DispatchPattern, l: A | number, r: A | number, context: C): CalcValue<C>;
    minus(pattern: DispatchPattern, l: A | number, r: A | number, context: C): CalcValue<C>;
    mult(pattern: DispatchPattern, l: A | number, r: A | number, context: C): CalcValue<C>;
    div(pattern: DispatchPattern, l: A | number, r: A | number, context: C): CalcValue<C>;
    negate(value: A, context: C): CalcValue<C>;
}

export interface Pending<T> {
    kind: "Pending";
    estimate?: T;
}

/**
 * A Readable type supports the dot operator.
 */
export interface ReadableType<A, C> {
    read(value: A, property: string, context: C): CalcValue<C> | Pending<CalcValue<C>>
}

/**
 * A ReferenceType type holds a pointer to another value.
 *
 * Operators will attempt to dereference a reference before applying
 * the operator. This happens once and is not recursive.
 */
export interface ReferenceType<A, C> {
    dereference(value: A, context: C): CalcValue<C> | Pending<CalcValue<C>>;
}

export type CheckFn<A> = <C>(context: C, value: DataValue<C>, pos: number) => value is DataValue<C> & A;
export type BlameFn = <C>(context: C, value: CalcValue<C>, pos: number) => CalcValue<C>;

export interface TypedUnaryOp<A> {
    check: CheckFn<A>;
    fn: <C>(context: C, value: A) => CalcValue<C>,
    blame: BlameFn;
}

export interface TypedBinOp<A> {
    check: CheckFn<A>;
    fn: <C>(context: C, value1: A, value2: A) => CalcValue<C>,
    blame: BlameFn;
}

/**
 * Evaluation Runtime
 */
export interface Runtime<Delay> {
    isDelayed(v: unknown): v is Delay;
    read: <C, F>(context: C, receiver: CalcValue<C> | Delay, prop: string, fallback: F) => CalcValue<C> | F | Delay;
    ifS: <T>(cond: boolean | Delay, cont: (cond: boolean) => T | Delay) => T | Delay;
    app1: <A, C>(context: C, op: TypedUnaryOp<A>, expr: CalcValue<C> | Delay) => CalcValue<C> | Delay;
    app2: <A, C>(context: C, op: TypedBinOp<A>, l: CalcValue<C> | Delay, r: CalcValue<C> | Delay) => CalcValue<C> | Delay;
    appN: <C, F>(context: C, fn: CalcValue<C> | Delay, args: (CalcValue<C> | Delay)[], fallback: F) => CalcValue<C> | F | Delay;
}

/**
 * The interface for an object that can bind to an IProducer.
 *
 * Any object that implements IConsumer is expected to provide a
 * callback whenever the component it is bound to changes in value and a reference
 * to the data that the consumer is bound to.
 */
export interface IConsumer<T> {
    /**
     * Invoked whenever the data this object is bound to is changed.
     */
    valueChanged<U extends T, K extends keyof U>(property: K, value: U[K], producer: IProducer<U>): void;
}

export interface IReader<T> {
    /**
     * Return the value associated with `property`.
     * @param property - The property of the Producer to read.
     */
    read<K extends keyof T>(property: K): T[K] | Pending<T[K]>;
}

/**
 * The interface for an object whose data can be bound to. We use this contract for
 * components that want to expose their data and its changes to other components.
 *
 * Any component that implements IProducer is expected to provide some registration
 * functionality and to notify consumers whenever the data they are bound to changes.
 */
export interface IProducer<T> {
    /**
     * Unsubscribes a consumer from this producer.
     * @param consumer - The consumer to unregister from the Producer.
     */
    removeConsumer(consumer: IConsumer<T>): void;

    /**
     * Returns a reader for this producer's values and implicitly subscribes the given
     * consumer to change notifications from this producer (if it isn't already).
     * 
     * @param consumer - The object to be notified of value changes.
     */
    open(consumer: IConsumer<T>): IReader<T>;
}

export interface IVectorConsumer<T> {
    /** Notification that a range of items have been inserted, removed, and/or replaced in the given vector. */
    itemsChanged(index: number, numRemoved: number, itemsInserted: ReadonlyArray<T>, producer: IVectorProducer<T>): void;
}

export interface IVectorReader<T> {
    readonly length: number;
    read(index: number): T;
}

/** Provides more efficient access to 1D data for vector-aware consumers. */
export interface IVectorProducer<T> {
    /**
     * Unsubscribes a consumer from this producer.
     * @param consumer - The consumer to unregister from the Producer.
     */
    removeVectorConsumer(consumer: IVectorConsumer<T>): void;

    openVector(consumer: IVectorConsumer<T>): IVectorReader<T>;
}

export interface IMatrixConsumer<T> {
    /** Notification that rows have been inserted, removed, and/or replaced in the given matrix. */
    rowsChanged(row: number, numRemoved: number, numInserted: number, producer: IMatrixProducer<T>): void;

    /** Notification that cols have been inserted, removed, and/or replaced in the given matrix. */
    colsChanged(col: number, numRemoved: number, numInserted: number, producer: IMatrixProducer<T>): void;

    /**
     * Notification that a range of cells have been replaced in the given matrix.  If the source
     * matrix has the new cell values already in an array, it may optionally pass these to consumers
     * as an optimization.
     */
    cellsChanged(row: number, col: number, numRows: number, numCols: number, values: ReadonlyArray<T> | undefined, producer: IMatrixProducer<T>): void;
}

export interface IMatrixReader<T> {
    readonly numRows: number;
    readonly numCols: number;
    read(row: number, col: number): T;
}

/** Provides more efficient access to 2D data for matrix-aware consumers. */
export interface IMatrixProducer<T> {
    /**
     * Unsubscribes a consumer from this producer.
     * @param consumer - The consumer to unregister from the Producer.
     */
    removeMatrixConsumer(consumer: IMatrixConsumer<T>): void;

    openMatrix(consumer: IMatrixConsumer<T>): IMatrixReader<T>;
}
