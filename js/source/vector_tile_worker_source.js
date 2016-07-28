'use strict';
var ajax = require('../util/ajax');
var vt = require('vector-tile');
var Protobuf = require('pbf');
var WorkerTile = require('./worker_tile');

module.exports = VectorTileWorkerSource;

/**
 * The {@link WorkerSource} implementation that supports {@link VectorTileSource}.
 * This class is designed to be easily reused to support custom source types
 * for data formats that can be parsed/converted into an in-memory VectorTile
 * representation.  To do so, create it with
 * `new VectorTileWorkerSource(actor, styles, customLoadVectorDataFunction)`.
 *
 * @class VectorTileWorkerSource
 * @private
 * @param {Function} [loadVectorData] Optional method for custom loading of a VectorTile object based on parameters passed from the main-thread Source.  See {@link VectorTileWorkerSource#loadTile}.  The default implementation simply loads the pbf at `params.url`.
 */
function VectorTileWorkerSource (actor, styles, loadVectorData) {
    this.actor = actor;
    this.styles = styles;

    if (loadVectorData) { this.loadVectorData = loadVectorData; }

    this.loading = {};
    this.loaded = {};
}

VectorTileWorkerSource.prototype = {
    /**
     * Implements {@link WorkerSource#loadTile}.  Delegates to {@link VectorTileWorkerSource#loadVectorData} (which by default expects a `params.url` property) for fetching and producing a VectorTile object.
     *
     * @param {object} params
     * @param {string} params.source The id of the source for which we're loading this tile.
     * @param {string} params.uid The UID for this tile.
     * @param {TileCoord} params.coord
     * @param {number} params.zoom
     * @param {number} params.overscaling
     * @param {number} params.angle
     * @param {number} params.pitch
     * @param {boolean} params.showCollisionBoxes
     */
    loadTile: function(map, params, callback) {
        var style = this.styles.getKey(map),
            source = params.source,
            uid = params.uid;

        var loading = this.loading[style + source];

        if (!loading)
            loading = this.loading[style + source] = {};

        if (loading[uid]) {
            loading[uid].callbacks.push(callback);
            return;
        }

        var tile = loading[uid] = new WorkerTile(params);
        tile.callbacks = [callback];
        callback = function (err, data) {
            tile.callbacks.forEach(function(cb) { cb(err, data); });
        };

        tile.abort = this.loadVectorData(params, done.bind(this));

        function done(err, data) {
            delete loading[uid];

            if (err) return callback(err);
            if (!data) return callback(null, null);

            tile.data = data.tile;
            tile.parse(tile.data, this.styles.getLayerFamilies(map), this.actor, data.rawTileData, callback);

            this.loaded[style + source] = this.loaded[style + source] || {};
            this.loaded[style + source][uid] = tile;
        }
    },

    /**
     * Implements {@link WorkerSource#reloadTile}.
     *
     * @param {object} params
     * @param {string} params.source The id of the source for which we're loading this tile.
     * @param {string} params.uid The UID for this tile.
     */
    reloadTile: function(map, params, callback) {
        var loaded = this.loaded[this.styles.getKey(map) + params.source],
            uid = params.uid;
        if (loaded && loaded[uid]) {
            var tile = loaded[uid];
            tile.parse(tile.data, this.styles.getLayerFamilies(map), this.actor, params.rawTileData, callback);
        }
    },

    /**
     * Implements {@link WorkerSource#abortTile}.
     *
     * @param {object} params
     * @param {string} params.source The id of the source for which we're loading this tile.
     * @param {string} params.uid The UID for this tile.
     */
    abortTile: function(map, params) {
        var loading = this.loading[this.styles.getKey(map) + params.source],
            uid = params.uid;
        if (loading && loading[uid] && loading[uid].abort) {
            loading[uid].abort();
            delete loading[uid];
        }
    },

    /**
     * Implements {@link WorkerSource#removeTile}.
     *
     * @param {object} params
     * @param {string} params.source The id of the source for which we're loading this tile.
     * @param {string} params.uid The UID for this tile.
     */
    removeTile: function(map, params) {
        var loaded = this.loaded[this.styles.getKey(map) + params.source],
            uid = params.uid;
        if (loaded && loaded[uid]) {
            delete loaded[uid];
        }
    },

    /**
     * @param {object} params
     * @param {string} params.url The URL of the tile PBF to load.
     */
    loadVectorData: function (params, callback) {
        var xhr = ajax.getArrayBuffer(params.url, done.bind(this));
        return function abort () { xhr.abort(); };
        function done(err, data) {
            if (err) { return callback(err); }
            var tile =  new vt.VectorTile(new Protobuf(new Uint8Array(data)));
            callback(err, { tile: tile, rawTileData: data });
        }
    }
};