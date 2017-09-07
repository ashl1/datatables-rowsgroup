/*! RowsGroup for DataTables v2.0.0
 * 2015-2016 Alexey Shildyakov ashl1future@gmail.com
 * 2016 Tibor Wekerle
 */

/**
 * @summary     RowsGroup
 * @description Group rows by specified columns
 * @version     2.0.0
 * @file        dataTables.rowsGroup.js
 * @author      Alexey Shildyakov (ashl1future@gmail.com)
 * @contact     ashl1future@gmail.com
 * @copyright   Alexey Shildyakov
 * 
 * License      MIT - http://datatables.net/license/mit
 *
 * This feature plug-in for DataTables automatically merges columns cells
 * based on it's values equality. It supports multi-column row grouping
 * in according to the requested order with dependency from each previous 
 * requested columns. Now it supports ordering and searching. 
 * Please see the example.html for details.
 * 
 * Rows grouping in DataTables can be enabled by using any one of the following
 * options:
 *
 * * Setting the `rowsGroup` parameter in the DataTables initialisation
 *   to array which containes columns selectors
 *   (https://datatables.net/reference/type/column-selector) used for grouping. i.e.
 *    rowsGroup = [1, 'columnName:name', ]
 * * Setting the `rowsGroup` parameter in the DataTables defaults
 *   (thus causing all tables to have this feature) - i.e.
 *   `$.fn.dataTable.defaults.RowsGroup = [0]`.
 * * Creating a new instance: `new $.fn.dataTable.RowsGroup( table, columnsForGrouping );`
 *   where `table` is a DataTable's API instance and `columnsForGrouping` is the array
 *   described above.
 *
 * For more detailed information please see:
 *     
 */

/* eslint-disable padded-blocks */
(function init($) {
/* eslint-enable padded-blocks */


function toggleDirection(dir) {
    return dir === 'asc' ? 'desc' : 'asc';
}

const ShowedDataSelectorModifier = {
    order: 'current',
    page: 'current',
    search: 'applied',
};

const GroupedColumnsOrderDir = 'asc';


/*
 * columnsForGrouping: array of DTAPI:cell-selector for columns for which rows grouping is applied
 */
class RowsGroup {
    constructor(dt, columnsForGrouping) {
        this.table = dt.table();
        this.columnsForGrouping = columnsForGrouping;
        // set to True when new reorder is applied by RowsGroup to prevent order() looping
        this.orderOverrideNow = false;
        this.mergeCellsNeeded = false; // merge after init
        this.order = [];
        
        dt.on('order.dt.rowsGroup', () => {
            if (!this.orderOverrideNow) {
                this.orderOverrideNow = true;
                this._updateOrderAndDraw();
            } else {
                this.orderOverrideNow = false;
            }
        });
        
        dt.on('preDraw.dt.rowsGroup', () => {
            if (this.mergeCellsNeeded) {
                this.mergeCellsNeeded = false;
                this._mergeCells();
            }
        });
        
        dt.on('column-visibility.dt.rowsGroup', () => {
            this.mergeCellsNeeded = true;
        });

        dt.on('search.dt.rowsGroup', () => {
            // This might to increase the time to redraw while searching on tables
            //   with huge shown columns
            this.mergeCellsNeeded = true;
        });

        dt.on('page.dt.rowsGroup', () => {
            this.mergeCellsNeeded = true;
        });

        dt.on('length.dt.rowsGroup', () => {
            this.mergeCellsNeeded = true;
        });

        dt.on('xhr.dt.rowsGroup', () => {
            this.mergeCellsNeeded = true;
        });

        this._updateOrderAndDraw();

        /* Events sequence while Add row (also through Editor)
         * addRow() function
         *   draw() function
         *     preDraw() event
         *       mergeCells() - point 1
         *     Appended new row breaks visible elements because the mergeCells()
         *     on previous step doesn't apply to already processing data
         *   order() event
         *     _updateOrderAndDraw()
         *       preDraw() event
         *         mergeCells()
         *       Appended new row now has properly visibility as on current level
         *       it has already applied changes from first mergeCells() call (point 1)
         *   draw() event
         */
    }

    setMergeCells() {
        this.mergeCellsNeeded = true;
    }

    mergeCells() {
        this.setMergeCells();
        this.table.draw();
    }

    _getOrderWithGroupColumns(order, groupedColumnsOrderDir = GroupedColumnsOrderDir) {
        const groupedColumnsIndexes = this.columnsForGrouping.map(
            columnSelector => this.table.column(columnSelector).index());
        const groupedColumnsKnownOrder = order.filter(
            columnOrder => groupedColumnsIndexes.indexOf(columnOrder[0]) >= 0);
        const nongroupedColumnsOrder = order.filter(
            columnOrder => groupedColumnsIndexes.indexOf(columnOrder[0]) < 0);
        const groupedColumnsKnownOrderIndexes = groupedColumnsKnownOrder.map(
            columnOrder => columnOrder[0]);
        const groupedColumnsOrder = groupedColumnsIndexes.map((iColumn) => {
            const iInOrderIndexes = groupedColumnsKnownOrderIndexes.indexOf(iColumn);
            if (iInOrderIndexes >= 0) {
                return [iColumn, groupedColumnsKnownOrder[iInOrderIndexes][1]];
            }
            return [iColumn, groupedColumnsOrderDir];
        });
        
        groupedColumnsOrder.push(...nongroupedColumnsOrder);
        return groupedColumnsOrder;
    }
 
    /* Workaround: the DT reset ordering to 'asc' from multi-ordering
     * if user order on one column (without shift)
     * but because we always have multi-ordering due to grouped rows
     * this happens every time
     */
    _getInjectedMonoSelectWorkaround(order) {
        if (order.length === 1) {
            // got mono order - workaround here
            const orderingColumn = order[0][0];
            const previousOrder = this.order.map(val => val[0]);
            const iColumn = previousOrder.indexOf(orderingColumn);
            if (iColumn >= 0) {
                // assume change the direction, because we already has that in previos order
                return [[orderingColumn, toggleDirection(this.order[iColumn][1])]];
            } // else This is the new ordering column. Proceed as is.
        } // else got milti order - work normal
        return order;
    }
    
    _mergeCells() {
        const columnsIndexes = this.table
            .columns(this.columnsForGrouping, ShowedDataSelectorModifier)
            .indexes().toArray();
        const showedRowsCount = this.table.rows(ShowedDataSelectorModifier)[0].length;
        this._mergeColumn(0, showedRowsCount - 1, columnsIndexes);
    }
    
    // the index is relative to the showed data
    //    (selector-modifier = {order: 'current', page: 'current', search: 'applied'}) index
    _mergeColumn(iStartRow, iFinishRow, columnsIndexes) {
        const columnsIndexesCopy = columnsIndexes.slice();
        let currentColumn = columnsIndexesCopy.shift();
        currentColumn = this.table.column(currentColumn, ShowedDataSelectorModifier);
        
        const columnNodes = currentColumn.nodes();
        const columnValues = currentColumn.data();
        
        let newSequenceRow = iStartRow;
        for (let iRow = iStartRow + 1; iRow <= iFinishRow; iRow += 1) {
            if (columnValues[iRow] === columnValues[newSequenceRow]) {
                $(columnNodes[iRow]).hide();
            } else {
                $(columnNodes[newSequenceRow]).show();
                $(columnNodes[newSequenceRow]).attr('rowspan', (iRow - 1) - newSequenceRow + 1);
                
                if (columnsIndexesCopy.length > 0) {
                    this._mergeColumn(newSequenceRow, (iRow - 1), columnsIndexesCopy);
                }
                
                newSequenceRow = iRow;
            }
        }
        $(columnNodes[newSequenceRow]).show();
        $(columnNodes[newSequenceRow]).attr('rowspan', iFinishRow - newSequenceRow + 1);
        if (columnsIndexesCopy.length > 0) {
            this._mergeColumn(newSequenceRow, iFinishRow, columnsIndexesCopy);
        }
    }
    
    _updateOrderAndDraw() {
        this.mergeCellsNeeded = true;
        
        let currentOrder = this.table.order();
        currentOrder = this._getInjectedMonoSelectWorkaround(currentOrder);
        this.order = this._getOrderWithGroupColumns(currentOrder);
        this.table.order($.extend(true, [], this.order));
        this.table.draw();
    }
}

/* eslint-disable no-param-reassign */
if ($.fn.dataTable) $.fn.dataTable.RowsGroup = RowsGroup;
if ($.fn.DataTable) $.fn.DataTable.RowsGroup = RowsGroup;
/* eslint-enable no-param-reassign */

// Automatic initialisation listener
$(document).on('init.dt.rowsGroup', (e, settings) => {
    if (e.namespace !== 'dt') {
        return;
    }

    const api = new $.fn.dataTable.Api(settings);
    
    if (settings.oInit.rowsGroup ||
         $.fn.dataTable.defaults.rowsGroup) {
        const options = settings.oInit.rowsGroup ?
            settings.oInit.rowsGroup :
            $.fn.dataTable.defaults.rowsGroup;
        const rowsGroup = new RowsGroup(api, options);
        $.fn.dataTable.Api.register('rowsgroup.update()', function update() {
            rowsGroup.mergeCells();
            return this;
        });
        $.fn.dataTable.Api.register('rowsgroup.updateNextDraw()', function updateNextDraw() {
            rowsGroup.setMergeCells();
            return this;
        });
    }
});


/* eslint-disable-line padded-blocks */
}(
    (typeof require === 'function')
        ? require('jQuery')
        : window.jQuery,
));

/*

TODO: Provide function which determines the all <tr>s and <td>s with "rowspan"
      html-attribute is parent (groupped) for the specified <tr> or <td>.
      To use in selections, editing or hover styles.

TODO: Feature
Use saved order direction for grouped columns
    Split the columns into grouped and ungrouped.
    
    user = grouped+ungrouped
    grouped = grouped
    saved = grouped+ungrouped
    
    For grouped uses following order: user -> saved
    (because 'saved' include 'grouped' after first initialisation).
    This should be done with saving order like for 'groupedColumns'
    For ungrouped: uses only 'user' input ordering
*/
